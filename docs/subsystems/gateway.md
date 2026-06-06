# 多渠道消息网关详细设计

## 一、设计目标

将 Cangjie 从单一 CLI 工具扩展为**全渠道 Agent 平台**，用户可以在 IM 应用中与 Cangjie 交互。

## 二、架构

```
                    ┌─────────────────────┐
                    │   Gateway Router    │
                    │  (统一消息路由)      │
                    └──────┬──────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐  ┌──────▼──────┐  ┌─────▼─────┐
    │ Telegram  │  │  Discord    │  │  Slack    │  ...
    │ Adapter   │  │  Adapter    │  │  Adapter   │
    └─────┬─────┘  └──────┬──────┘  └─────┬─────┘
          │                │                │
    ┌─────▼─────┐  ┌──────▼──────┐  ┌─────▼─────┐
    │ Telegram  │  │  Discord    │  │  Slack    │
    │ Bot API   │  │  Gateway    │  │  RTM API  │
    └───────────┘  └─────────────┘  └───────────┘
```

## 三、核心接口

```go
// Channel 是消息渠道的抽象。
type Channel interface {
    // ID 返回渠道唯一标识。
    ID() string
    
    // Platform 返回平台类型。
    Platform() Platform
    
    // Start 启动渠道，开始接收消息。
    Start(ctx context.Context) error
    
    // Stop 停止渠道。
    Stop(ctx context.Context) error
    
    // Messages 返回接收到的消息通道。
    Messages() <-chan *IncomingMessage
    
    // Send 发送一条回复。
    Send(ctx context.Context, msg *OutgoingMessage) error
    
    // Status 返回渠道状态。
    Status() ChannelStatus
}

type Platform string
const (
    PlatformTelegram  Platform = "telegram"
    PlatformDiscord   Platform = "discord"
    PlatformSlack     Platform = "slack"
    PlatformWhatsApp  Platform = "whatsapp"
    PlatformWeChat    Platform = "wechat"
    PlatformWebhook   Platform = "webhook"
    PlatformWebChat   Platform = "webchat"
)
```

### 消息模型

```go
// IncomingMessage 是标准化后的入站消息。
type IncomingMessage struct {
    ID          string             // 消息 ID
    Platform    Platform           // 来源平台
    ChannelID   string             // 渠道 ID
    UserID      string             // 用户 ID（跨渠道统一）
    UserName    string             // 用户显示名
    Content     string             // 消息文本
    Attachments []Attachment       // 附件（图片、文件）
    ReplyTo     string             // 回复的消息 ID
    
    // 元数据
    ChatID      string             // 对话/频道 ID
    IsGroup     bool               // 是否群聊
    Timestamp   time.Time
    
    // 原始数据
    Raw         any                // 平台原始消息对象
    Metadata    map[string]any
}

// OutgoingMessage 是标准化后的出站消息。
type OutgoingMessage struct {
    Content     string
    ReplyTo     string             // 回复的消息 ID
    Attachments []OutgoingAttachment
    Markdown    bool               // 是否使用 Markdown 格式
    
    // 分页（长消息自动拆分）
    Parts       []string           // 多条消息分段
}

// Attachment 附件。
type Attachment struct {
    Type     AttachmentType  // image, file, audio, video
    URL      string
    Name     string
    MimeType string
    Size     int64
}

type AttachmentType string
const (
    AttachImage AttachmentType = "image"
    AttachFile  AttachmentType = "file"
    AttachAudio AttachmentType = "audio"
    AttachVideo AttachmentType = "video"
)
```

## 四、Gateway 路由器

```go
// Gateway 统一管理所有渠道。
type Gateway struct {
    channels map[string]Channel
    
    // 用户会话管理
    sessions *UserSessionManager
    
    // 消息处理
    handler  MessageHandler
    queue    chan *IncomingMessage // 消息队列（缓冲）
    
    // Agent 连接
    agent AgentClient  // 到 Agent 编排器的连接
}

// Start 启动所有渠道。
func (gw *Gateway) Start(ctx context.Context) error {
    for _, ch := range gw.channels {
        go gw.dispatchLoop(ctx, ch)
        ch.Start(ctx)
    }
    return nil
}

// dispatchLoop 分发消息循环。
func (gw *Gateway) dispatchLoop(ctx context.Context, ch Channel) {
    for {
        select {
        case <-ctx.Done():
            return
        case msg := <-ch.Messages():
            response := gw.handler.Handle(ctx, msg)
            if response != nil {
                ch.Send(ctx, response)
            }
        }
    }
}
```

### 用户会话管理

```go
// UserSessionManager 管理跨渠道的用户会话。
// 同一个用户在不同渠道的消息关联到同一个 Agent 会话。
type UserSessionManager struct {
    sessions map[string]*UserSession  // userID → session
    mu       sync.RWMutex
}

type UserSession struct {
    UserID       string
    AgentSession *Session            // Agent 会话
    LastActive   time.Time
    Channels     []string            // 用户使用的渠道
    Preferences  UserPreferences     // 用户偏好
}

type UserPreferences struct {
    PreferredChannel Platform  // 首选渠道
    Language         string    // 语言偏好
    Timezone         string    // 时区
    ModelPreference  string    // 偏好的模型
    NotifyOnComplete bool      // 任务完成时通知
}
```

## 五、消息路由规则

```go
// MessageRoute 定义消息路由规则。
type MessageRoute struct {
    // 触发条件
    MentionOnly  bool     // 仅被 @ 提及才响应
    Prefixes     []string // 前缀触发（如 "!cj", "/cj"）
    AlwaysListen bool     // 监听所有消息（私聊模式）
    
    // 响应模式
    ReplyMode    ReplyMode // inline / thread / dm
}

type ReplyMode string
const (
    ReplyInline  ReplyMode = "inline"   // 直接在群聊中回复
    ReplyThread  ReplyMode = "thread"   // 在帖子中回复（如 Slack thread）
    ReplyDM      ReplyMode = "dm"       // 私聊回复
)

// Router 根据消息内容和上下文决定如何处理。
func (gw *Gateway) Router() *MessageRouter {
    return &MessageRouter{
        routes: []MessageRoute{
            // 私聊：总是监听
            {AlwaysListen: true, ReplyMode: ReplyInline,
             Condition: func(m *IncomingMessage) bool { return !m.IsGroup }},
            
            // 群聊：需要 @ 提及或前缀
            {MentionOnly: true, ReplyMode: ReplyThread,
             Condition: func(m *IncomingMessage) bool { return m.IsGroup }},
        },
    }
}
```

## 六、渠道适配器

### Telegram 示例

```go
type TelegramAdapter struct {
    token  string
    bot    *telegram.BotAPI
    msgCh  chan *IncomingMessage
}

func (a *TelegramAdapter) Start(ctx context.Context) error {
    updates := a.bot.GetUpdatesChan(telegram.UpdateConfig{
        Offset:  0,
        Timeout: 60,
    })
    
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case update := <-updates:
                if update.Message != nil {
                    a.msgCh <- a.convert(update.Message)
                }
            }
        }
    }()
    
    return nil
}

func (a *TelegramAdapter) convert(tgMsg *telegram.Message) *IncomingMessage {
    msg := &IncomingMessage{
        ID:        strconv.Itoa(tgMsg.MessageID),
        Platform:  PlatformTelegram,
        ChannelID: a.ID(),
        UserID:    strconv.FormatInt(tgMsg.From.ID, 10),
        UserName:  tgMsg.From.UserName,
        Content:   tgMsg.Text,
        ChatID:    strconv.FormatInt(tgMsg.Chat.ID, 10),
        IsGroup:   tgMsg.Chat.IsGroup() || tgMsg.Chat.IsSuperGroup(),
        Timestamp: tgMsg.Time(),
    }
    
    // 图片附件
    if tgMsg.Photo != nil {
        msg.Attachments = append(msg.Attachments, Attachment{
            Type: AttachImage,
            URL:  tgMsg.Photo[len(tgMsg.Photo)-1].FileID,
        })
    }
    
    return msg
}

func (a *TelegramAdapter) Send(ctx context.Context, msg *OutgoingMessage) error {
    tgMsg := telegram.NewMessage(/* chatID */, msg.Content)
    tgMsg.ParseMode = "Markdown"
    
    if msg.ReplyTo != "" {
        replyID, _ := strconv.Atoi(msg.ReplyTo)
        tgMsg.ReplyToMessageID = replyID
    }
    
    _, err := a.bot.Send(tgMsg)
    return err
}
```

## 七、配置

```toml
# cangjie.toml

[gateway]
enabled = true

[gateway.telegram]
enabled = true
token = "${TELEGRAM_BOT_TOKEN}"

[gateway.telegram.routes]
mention_only = false         # 允许不经 @ 响应
reply_mode = "inline"

[gateway.discord]
enabled = false
token = "${DISCORD_BOT_TOKEN}"

[gateway.discord.routes]
mention_only = true
reply_mode = "thread"

[gateway.slack]
enabled = false
token = "${SLACK_BOT_TOKEN}"
app_token = "${SLACK_APP_TOKEN}"

[gateway.wechat]
enabled = false
corp_id = "${WECHAT_CORP_ID}"
corp_secret = "${WECHAT_CORP_SECRET}"
agent_id = "${WECHAT_AGENT_ID}"
```

## 八、交互示例

### 编程任务（Telegram）

```
User: @cangjie 给项目加一个 HTTP 健康检查接口

Cangjie: 🔍 Analyzing project...
         发现 Go 项目，使用 gin 框架
        
         📋 Plan:
         1. 添加 /health 路由到 router.go
         2. 返回 {"status":"ok"} JSON
        
         执行中...
         
         ✅ 已在 router.go:42 添加健康检查路由
         ✅ 测试通过: curl localhost:8080/health → {"status":"ok"}
         
         Diff 预览:
         + router.GET("/health", func(c *gin.Context) {
         +     c.JSON(200, gin.H{"status": "ok"})
         + })
```

### 定时提醒（Telegram）

```
User: @cangjie 每天早上9点提醒我看 PR review

Cangjie: ✅ 已设置定时任务
         名称: daily-pr-reminder
         时间: 每天 09:00 Asia/Shanghai
         内容: 提醒检查待处理的 PR review
```
