# 调度系统详细设计

## 一、设计目标

1. **定时任务**：Cron 表达式驱动的周期任务
2. **一次性任务**：延迟执行的一次性 Agent 指令
3. **长时任务**：支持数小时甚至数天的 Agent 任务
4. **通知机制**：任务完成时通过多渠道推送结果

## 二、核心模型

```go
// Job 代表一个调度任务。
type Job struct {
    ID          string        `json:"id"`
    Name        string        `json:"name"`
    Description string        `json:"description"`
    
    // 调度配置
    Schedule    Schedule      `json:"schedule"`
    
    // Agent 指令
    AgentConfig AgentJobConfig `json:"agent_config"`
    
    // 状态
    Status      JobStatus     `json:"status"`
    LastRun     *JobRun       `json:"last_run"`
    NextRun     time.Time     `json:"next_run"`
    
    // 通知
    Notify      NotifyConfig  `json:"notify"`
    
    CreatedAt   time.Time     `json:"created_at"`
    UpdatedAt   time.Time     `json:"updated_at"`
}

type JobStatus string
const (
    JobStatusActive    JobStatus = "active"
    JobStatusPaused    JobStatus = "paused"
    JobStatusCompleted JobStatus = "completed"
    JobStatusFailed    JobStatus = "failed"
)

// Schedule 定义调度规则。
type Schedule struct {
    Type ScheduleType `json:"type"`
    
    // Cron 模式
    Cron  string `json:"cron,omitempty"`   // "0 9 * * *" (每天9点)
    TZ    string `json:"tz,omitempty"`     // "Asia/Shanghai"
    
    // 一次性模式
    RunAt *time.Time `json:"run_at,omitempty"`
    
    // 间隔模式
    Interval string `json:"interval,omitempty"` // "1h", "30m"
    
    // 重试
    RetryPolicy *RetryPolicy `json:"retry_policy,omitempty"`
}

type ScheduleType string
const (
    ScheduleCron     ScheduleType = "cron"
    ScheduleOnce     ScheduleType = "once"
    ScheduleInterval ScheduleType = "interval"
)

type RetryPolicy struct {
    MaxRetries int           `json:"max_retries"`
    Backoff    time.Duration `json:"backoff"`    // 初始退避时间
    MaxBackoff time.Duration `json:"max_backoff"` // 最大退避时间
}

// AgentJobConfig 描述要执行的 Agent 任务。
type AgentJobConfig struct {
    Instruction  string `json:"instruction"`   // Agent 指令
    Workspace    string `json:"workspace"`     // 工作目录
    Model        string `json:"model"`         // 使用的模型
    SystemPrompt string `json:"system_prompt"` // 系统提示
    MaxSteps     int    `json:"max_steps"`     // 最大步数
    
    // 上下文
    ContextFiles []string `json:"context_files"` // 预加载的文件
    GitBranch    string   `json:"git_branch"`    // Git 分支
}

// NotifyConfig 任务完成后的通知配置。
type NotifyConfig struct {
    OnSuccess []string `json:"on_success"` // 通知渠道
    OnFailure []string `json:"on_failure"`
    Channels  []NotifyChannel `json:"channels"` // 通知目标列表
}

type NotifyChannel struct {
    Type     Platform `json:"type"`      // telegram, discord, slack, email
    Target   string   `json:"target"`    // chat ID / email / webhook URL
}

// JobRun 记录一次任务执行。
type JobRun struct {
    ID          string        `json:"id"`
    JobID       string        `json:"job_id"`
    Status      JobRunStatus  `json:"status"`
    StartedAt   time.Time     `json:"started_at"`
    FinishedAt  *time.Time    `json:"finished_at"`
    Duration    time.Duration `json:"duration"`
    
    // 结果
    SessionID   string        `json:"session_id"`    // Agent 会话 ID
    Result      string        `json:"result"`        // 最终结果文本
    Steps       int           `json:"steps"`         // 执行的步数
    TokensUsed  int           `json:"tokens_used"`   // 消耗的 Token
    
    // 错误
    Error       string        `json:"error,omitempty"`
    RetryCount  int           `json:"retry_count"`
}

type JobRunStatus string
const (
    RunStatusRunning   JobRunStatus = "running"
    RunStatusCompleted JobRunStatus = "completed"
    RunStatusFailed    JobRunStatus = "failed"
    RunStatusCancelled JobRunStatus = "cancelled"
)
```

## 三、调度器实现

```go
// Scheduler 是任务调度的核心组件。
type Scheduler struct {
    jobs     map[string]*Job
    store    JobStore       // 持久化
    runner   *JobRunner     // 执行器
    notifier *Notifier      // 通知器
    cron     *cron.Cron     // cron 解析器（robfig/cron）
    agent    AgentClient    // Agent API 客户端
    
    mu       sync.RWMutex
    ctx      context.Context
    cancel   context.CancelFunc
}

func NewScheduler(store JobStore, agent AgentClient, notifier *Notifier) *Scheduler {
    ctx, cancel := context.WithCancel(context.Background())
    return &Scheduler{
        jobs:     make(map[string]*Job),
        store:    store,
        runner:   NewJobRunner(agent),
        notifier: notifier,
        cron:     cron.New(cron.WithLocation(time.Local)),
        agent:    agent,
        ctx:      ctx,
        cancel:   cancel,
    }
}

// Start 启动调度器，加载已有任务并开始调度。
func (s *Scheduler) Start() error {
    // 1. 从存储加载所有活跃任务
    jobs, err := s.store.List(JobFilter{Status: JobStatusActive})
    if err != nil {
        return fmt.Errorf("load jobs: %w", err)
    }
    
    for _, job := range jobs {
        s.jobs[job.ID] = job
        
        // 2. 注册到 cron
        switch job.Schedule.Type {
        case ScheduleCron:
            s.cron.AddFunc(job.Schedule.Cron, func() {
                s.runJob(job.ID)
            })
        case ScheduleOnce:
            s.scheduleOnce(job)
        case ScheduleInterval:
            s.cron.AddFunc("@every "+job.Schedule.Interval, func() {
                s.runJob(job.ID)
            })
        }
    }
    
    // 3. 启动 cron
    s.cron.Start()
    
    return nil
}

// ScheduleOnce 调度一次性任务。
func (s *Scheduler) scheduleOnce(job *Job) {
    delay := time.Until(*job.Schedule.RunAt)
    if delay <= 0 {
        // 已经过期，立即执行
        go s.runJob(job.ID)
        return
    }
    time.AfterFunc(delay, func() {
        s.runJob(job.ID)
    })
}
```

## 四、任务执行器

```go
// JobRunner 执行 Agent 任务。
type JobRunner struct {
    agent      AgentClient
    maxConcurrent int // 最大并发任务数
    semaphore  chan struct{}
}

func (r *JobRunner) Run(ctx context.Context, job *Job) (*JobRun, error) {
    // 并发控制
    select {
    case r.semaphore <- struct{}{}:
        defer func() { <-r.semaphore }()
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    
    run := &JobRun{
        ID:        uuid.New().String(),
        JobID:     job.ID,
        Status:    RunStatusRunning,
        StartedAt: time.Now(),
    }
    
    // 执行 Agent 任务
    session, err := r.agent.Run(ctx, AgentRequest{
        Instruction:  job.AgentConfig.Instruction,
        Workspace:    job.AgentConfig.Workspace,
        Model:        job.AgentConfig.Model,
        SystemPrompt: job.AgentConfig.SystemPrompt,
        MaxSteps:     job.AgentConfig.MaxSteps,
    })
    
    run.FinishedAt = timePtr(time.Now())
    run.Duration = time.Since(run.StartedAt)
    
    if err != nil {
        run.Status = RunStatusFailed
        run.Error = err.Error()
        return run, err
    }
    
    run.Status = RunStatusCompleted
    run.SessionID = session.ID
    run.Steps = session.StepCount
    run.TokensUsed = session.TotalTokens
    
    if len(session.Messages) > 0 {
        run.Result = session.Messages[len(session.Messages)-1].Content
    }
    
    return run, nil
}
```

## 五、重试机制

```go
func (s *Scheduler) runJob(jobID string) {
    s.mu.RLock()
    job, ok := s.jobs[jobID]
    s.mu.RUnlock()
    
    if !ok {
        return
    }
    
    retries := 0
    maxRetries := 0
    backoff := 10 * time.Second
    maxBackoff := 10 * time.Minute
    
    if job.Schedule.RetryPolicy != nil {
        maxRetries = job.Schedule.RetryPolicy.MaxRetries
        backoff = job.Schedule.RetryPolicy.Backoff
        maxBackoff = job.Schedule.RetryPolicy.MaxBackoff
    }
    
    for {
        run, err := s.runner.Run(s.ctx, job)
        
        if err == nil {
            // 成功
            s.store.SaveRun(run)
            s.notifier.NotifySuccess(job, run)
            return
        }
        
        if retries >= maxRetries {
            // 重试耗尽
            run.Status = RunStatusFailed
            run.RetryCount = retries
            s.store.SaveRun(run)
            s.notifier.NotifyFailure(job, run)
            return
        }
        
        retries++
        run.RetryCount = retries
        
        // 指数退避
        sleep := backoff * time.Duration(1<<(retries-1))
        if sleep > maxBackoff {
            sleep = maxBackoff
        }
        
        log.Warn("job %s failed (retry %d/%d), sleeping %v: %v",
            job.Name, retries, maxRetries, sleep, err)
        
        select {
        case <-time.After(sleep):
            continue
        case <-s.ctx.Done():
            return
        }
    }
}
```

## 六、通知器

```go
// Notifier 在任务完成/失败时发送通知。
type Notifier struct {
    gateway *Gateway  // 复用到多渠道网关
}

func (n *Notifier) NotifySuccess(job *Job, run *JobRun) {
    msg := n.formatResult(job, run, "✅")
    n.send(job, msg)
}

func (n *Notifier) NotifyFailure(job *Job, run *JobRun) {
    msg := n.formatResult(job, run, "❌")
    n.send(job, msg)
}

func (n *Notifier) formatResult(job *Job, run *JobRun, emoji string) string {
    var b strings.Builder
    b.WriteString(fmt.Sprintf("%s **%s** 执行完成\n\n", emoji, job.Name))
    
    if run.Status == RunStatusCompleted {
        b.WriteString(fmt.Sprintf("耗时: %v\n", run.Duration.Round(time.Second)))
        b.WriteString(fmt.Sprintf("步骤: %d\n", run.Steps))
        b.WriteString(fmt.Sprintf("Token: %d\n", run.TokensUsed))
        b.WriteString(fmt.Sprintf("\n结果:\n```\n%s\n```", truncate(run.Result, 2000)))
    } else {
        b.WriteString(fmt.Sprintf("错误: %s\n", run.Error))
        if run.RetryCount > 0 {
            b.WriteString(fmt.Sprintf("重试: %d 次\n", run.RetryCount))
        }
    }
    
    return b.String()
}

func (n *Notifier) send(job *Job, message string) {
    for _, ch := range job.Notify.Channels {
        n.gateway.Send(context.Background(), &OutgoingMessage{
            Content:  message,
            Markdown: true,
        }, ch.Target)
    }
}
```

## 七、CLI 命令

```bash
# 创建定时任务
cj job create --name "daily-report" \
    --cron "0 9 * * *" \
    --instruction "总结当前项目的最近变更，生成日报" \
    --notify telegram

# 创建一次性任务
cj job once --at "2026-06-07T14:00:00+08:00" \
    --instruction "检查 main.go 的测试覆盖率"

# 间隔任务
cj job create --name "health-check" \
    --interval "30m" \
    --instruction "检查服务健康状态"

# 列出任务
cj job list

# 查看任务执行历史
cj job history <job-id>

# 暂停/恢复
cj job pause <job-id>
cj job resume <job-id>

# 删除
cj job delete <job-id>

# 立即触发一次
cj job run <job-id>
```

## 八、持久化

```sql
CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    schedule     TEXT NOT NULL,       -- JSON
    agent_config TEXT NOT NULL,       -- JSON
    status       TEXT NOT NULL DEFAULT 'active',
    notify       TEXT DEFAULT '{}',   -- JSON
    next_run     DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job_runs (
    id          TEXT PRIMARY KEY,
    job_id      TEXT NOT NULL,
    status      TEXT NOT NULL,
    started_at  DATETIME NOT NULL,
    finished_at DATETIME,
    duration_ms INTEGER,
    session_id  TEXT,
    result      TEXT,
    steps       INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    error       TEXT,
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_runs_job ON job_runs(job_id, started_at DESC);
```
