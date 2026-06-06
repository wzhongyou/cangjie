# 沙箱安全系统详细设计

## 一、设计目标

1. **默认安全**：所有外部命令默认在沙箱中执行
2. **OS 原生**：利用操作系统安全机制，不依赖虚拟化
3. **可配置**：strict/loose/off 三级模式
4. **跨平台**：macOS（Seatbelt）、Linux（Bubblewrap + seccomp）

## 二、接口定义

```go
// Sandbox 是沙箱执行环境。
type Sandbox interface {
    // Run 在沙箱中执行命令。
    Run(ctx context.Context, cmd Command, policy Policy) (*Result, error)

    // Validate 检查命令是否被沙箱策略允许。
    Validate(ctx context.Context, cmd Command, policy Policy) error
}

// Command 描述要执行的命令。
type Command struct {
    Executable string   // 可执行文件路径
    Args       []string // 命令行参数
    WorkingDir string   // 工作目录
    Env        []string // 环境变量（白名单）
    Stdin      io.Reader
}

// Policy 定义沙箱策略。
type Policy struct {
    Mode           SandboxMode     // 沙箱模式
    AllowedPaths   []PathRule      // 允许访问的路径
    AllowedDomains []string        // 允许的网络域名
    AllowNetwork   bool           // 是否允许网络访问
    MaxRuntime     time.Duration  // 最大运行时间
    MaxMemory      int64          // 最大内存（bytes）
}

// PathRule 定义路径访问规则。
type PathRule struct {
    Path      string   // 路径
    ReadOnly  bool     // 是否只读
    Allow     bool     // 允许还是禁止
}

type SandboxMode string
const (
    ModeStrict SandboxMode = "strict" // 完全隔离，只允许声明过的权限
    ModeLoose  SandboxMode = "loose"  // 宽松隔离，仅禁止危险操作
    ModeOff    SandboxMode = "off"    // 无沙箱（不推荐）
)
```

## 三、macOS 实现（Seatbelt）

### 原理

macOS 提供 `sandbox-exec` 命令和 Seatbelt sandbox 框架。通过 `.sb` 配置文件定义沙箱规则。

### 实现策略

```go
//go:build darwin

type SeatbeltSandbox struct {
    profileDir string // 动态生成 .sb 配置的目录
}

func (s *SeatbeltSandbox) Run(ctx context.Context, cmd Command, policy Policy) (*Result, error) {
    // 1. 根据 policy 生成 .sb 配置文件
    profile := s.generateProfile(policy, cmd)

    // 2. 将 profile 写入临时文件
    profilePath := filepath.Join(s.profileDir, uuid.New().String()+".sb")
    defer os.Remove(profilePath)

    // 3. 通过 sandbox-exec 执行
    // sandbox-exec -f profilePath -- cmd args...
    execCmd := exec.CommandContext(ctx, "sandbox-exec",
        "-f", profilePath,
        "--", cmd.Executable,
    )
    execCmd.Args = append(execCmd.Args, cmd.Args...)

    return runCmd(execCmd)
}

func (s *SeatbeltSandbox) generateProfile(policy Policy, cmd Command) string {
    // 生成类似如下的配置：
    // (version 1)
    // (allow default)
    // (deny file-write* (subpath "/usr"))
    // (deny file-write* (subpath "/etc"))
    // (allow file-read* (subpath "/Users/user/project"))
    // (allow file-write* (subpath "/Users/user/project"))
    // (deny network*)
}
```

### 默认策略（Strict 模式）

```
(version 1)
;; 默认拒绝
(deny default)

;; 允许进程基础操作
(allow process-fork)
(allow process-exec)

;; 系统只读
(allow file-read* (subpath "/usr/lib"))
(allow file-read* (subpath "/System/Library"))
(allow file-read* (subpath "/Library/Frameworks"))

;; 项目目录读写
(allow file-read* (subpath "{project_dir}"))
(allow file-write* (subpath "{project_dir}"))

;; 临时目录
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))

;; 仅允许 API 域名的网络访问
(allow network-outbound (remote "api.openai.com"))
(allow network-outbound (remote "api.anthropic.com"))

;; 禁止其他一切
(deny network*)
```

## 四、Linux 实现（Bubblewrap + seccomp）

### 原理

Bubblewrap（`bwrap`）创建轻量级容器命名空间隔离。seccomp 过滤系统调用。

### 实现策略

```go
//go:build linux

type BubblewrapSandbox struct{}

func (s *BubblewrapSandbox) Run(ctx context.Context, cmd Command, policy Policy) (*Result, error) {
    // bwrap \
    //   --ro-bind /usr /usr \        # 系统只读
    //   --ro-bind /etc /etc \        # 配置只读
    //   --bind /tmp /tmp \           # 临时目录可写
    //   --bind {project_dir} {project_dir} \  # 项目目录可写
    //   --unshare-all \              # 隔离所有命名空间
    //   --share-net \                # 共享网络（如需）
    //   --die-with-parent \          # 父进程退出时清理
    //   --seccomp {seccomp_json} \   # seccomp 过滤
    //   cmd args...
    
    args := s.buildBwrapArgs(cmd, policy)
    execCmd := exec.CommandContext(ctx, "bwrap", args...)
    return runCmd(execCmd)
}
```

### Seccomp 默认规则

```json
{
    "defaultAction": "SCMP_ACT_ERRNO",
    "architectures": ["SCMP_ARCH_X86_64"],
    "syscalls": [
        {"names": ["read", "write", "open", "close", "stat", "fstat", "lstat",
                   "poll", "lseek", "mmap", "mprotect", "munmap", "brk",
                   "rt_sigaction", "rt_sigprocmask", "rt_sigreturn",
                   "ioctl", "pread64", "pwrite64", "readv", "writev",
                   "access", "pipe", "select", "sched_yield", "mremap",
                   "msync", "mincore", "madvise", "shmget", "shmat",
                   "shmctl", "dup", "dup2", "pause", "nanosleep",
                   "getitimer", "alarm", "setitimer", "getpid", "sendfile",
                   "socket", "connect", "accept", "sendto", "recvfrom",
                   "sendmsg", "recvmsg", "shutdown", "bind", "listen",
                   "getsockname", "getpeername", "socketpair", "setsockopt",
                   "getsockopt", "clone", "fork", "vfork", "execve",
                   "exit", "wait4", "kill", "uname", "semget", "semop",
                   "semctl", "shmdt", "msgget", "msgsnd", "msgrcv",
                   "msgctl", "fcntl", "flock", "fsync", "fdatasync",
                   "truncate", "ftruncate", "getdents", "getcwd",
                   "chdir", "fchdir", "rename", "mkdir", "rmdir",
                   "creat", "link", "unlink", "symlink", "readlink",
                   "chmod", "fchmod", "chown", "fchown", "lchown",
                   "umask", "gettimeofday", "getrlimit", "getrusage",
                   "sysinfo", "times", "ptrace", "getuid", "syslog",
                   "getgid", "setuid", "setgid", "geteuid", "getegid",
                   "setpgid", "getppid", "getpgrp", "setsid",
                   "setreuid", "setregid", "getgroups", "setgroups",
                   "setresuid", "getresuid", "setresgid", "getresgid",
                   "getpgid", "setfsuid", "setfsgid", "getsid",
                   "capget", "capset", "rt_sigpending", "rt_sigqueueinfo",
                   "rt_sigsuspend", "sigaltstack", "utime", "mknod",
                   "uselib", "personality", "ustat", "statfs", "fstatfs",
                   "sysfs", "getpriority", "setpriority", "sched_setparam",
                   "sched_getparam", "sched_setscheduler",
                   "sched_getscheduler", "sched_get_priority_max",
                   "sched_get_priority_min", "sched_rr_get_interval",
                   "mlock", "munlock", "mlockall", "munlockall",
                   "vhangup", "modify_ldt", "pivot_root", "_sysctl",
                   "prctl", "arch_prctl", "adjtimex", "setrlimit",
                   "chroot", "sync", "acct", "settimeofday", "mount",
                   "umount2", "swapon", "swapoff", "reboot",
                   "sethostname", "setdomainname", "iopl", "ioperm",
                   "create_module", "init_module", "delete_module",
                   "get_kernel_syms", "query_module", "quotactl",
                   "nfsservctl", "getpmsg", "putpmsg", "afs_syscall",
                   "tuxcall", "security", "gettid", "readahead",
                   "setxattr", "lsetxattr", "fsetxattr", "getxattr",
                   "lgetxattr", "fgetxattr", "listxattr", "llistxattr",
                   "flistxattr", "removexattr", "lremovexattr",
                   "fremovexattr", "tkill", "time", "futex",
                   "sched_setaffinity", "sched_getaffinity",
                   "set_thread_area", "io_setup", "io_destroy",
                   "io_getevents", "io_submit", "io_cancel",
                   "get_thread_area", "lookup_dcookie", "epoll_create",
                   "epoll_ctl_old", "epoll_wait_old", "remap_file_pages",
                   "getdents64", "set_tid_address", "restart_syscall",
                   "semtimedop", "fadvise64", "timer_create",
                   "timer_settime", "timer_gettime", "timer_getoverrun",
                   "timer_delete", "clock_settime", "clock_gettime",
                   "clock_getres", "clock_nanosleep", "exit_group",
                   "epoll_wait", "epoll_ctl", "tgkill", "utimes",
                   "vserver", "mbind", "set_mempolicy", "get_mempolicy",
                   "mq_open", "mq_unlink", "mq_timedsend",
                   "mq_timedreceive", "mq_notify", "mq_getsetattr",
                   "kexec_load", "waitid", "add_key", "request_key",
                   "keyctl", "ioprio_set", "ioprio_get", "inotify_init",
                   "inotify_add_watch", "inotify_rm_watch", "migrate_pages",
                   "openat", "mkdirat", "mknodat", "fchownat",
                   "futimesat", "newfstatat", "unlinkat", "renameat",
                   "linkat", "symlinkat", "readlinkat", "fchmodat",
                   "faccessat", "pselect6", "ppoll", "unshare",
                   "set_robust_list", "get_robust_list", "splice",
                   "tee", "sync_file_range", "vmsplice", "move_pages",
                   "utimensat", "epoll_pwait", "signalfd", "timerfd_create",
                   "eventfd", "fallocate", "timerfd_settime",
                   "timerfd_gettime", "accept4", "signalfd4",
                   "eventfd2", "epoll_create1", "dup3", "pipe2",
                   "inotify_init1", "preadv", "pwritev", "rt_tgsigqueueinfo",
                   "perf_event_open", "recvmmsg", "fanotify_init",
                   "fanotify_mark", "prlimit64", "name_to_handle_at",
                   "open_by_handle_at", "clock_adjtime", "syncfs",
                   "sendmmsg", "setns", "getns", "process_vm_readv",
                   "process_vm_writev", "kcmp", "finit_module",
                   "sched_setattr", "sched_getattr", "renameat2",
                   "seccomp", "getrandom", "memfd_create", "kexec_file_load",
                   "bpf", "execveat", "userfaultfd", "membarrier",
                   "mlock2", "copy_file_range", "preadv2", "pwritev2",
                   "pkey_mprotect", "pkey_alloc", "pkey_free",
                   "statx", "io_pgetevents", "rseq"],
         "action": "SCMP_ACT_ALLOW"
        }
    ]
}
```

## 五、沙箱使用场景

### Shell 工具集成

```go
func (s *ShellTool) Execute(ctx context.Context, args map[string]any) (string, error) {
    policy := Policy{
        Mode:         ModeStrict,
        AllowedPaths: s.getAllowedPaths(args),
        AllowNetwork: false,
        MaxRuntime:   120 * time.Second,
    }
    
    cmd := Command{
        Executable: "/bin/bash",
        Args:       []string{"-c", args["command"].(string)},
        WorkingDir: s.workspaceRoot,
    }
    
    result, err := s.sandbox.Run(ctx, cmd, policy)
    return result.Stdout, err
}
```

### 测试运行集成

```go
func (t *TestRunnerTool) Execute(ctx context.Context, args map[string]any) (string, error) {
    policy := Policy{
        Mode:         ModeLoose,   // 测试可能需要更多权限
        AllowedPaths: []PathRule{
            {Path: t.workspaceRoot, ReadOnly: false},
            {Path: "/tmp", ReadOnly: false},
        },
        AllowNetwork: true,       // 测试可能需要连接数据库
        MaxRuntime:   300 * time.Second,
    }
    // ...
}
```

## 六、降级策略

```go
func NewSandbox(mode SandboxMode) (Sandbox, error) {
    switch runtime.GOOS {
    case "darwin":
        return &SeatbeltSandbox{}, nil
    case "linux":
        if bwrapAvailable() {
            return &BubblewrapSandbox{}, nil
        }
        // 降级：Bubblewrap 不可用时尝试 seccomp
        return &SeccompOnlySandbox{}, nil
    default:
        // 不支持沙箱的平台，返回警告
        log.Warn("sandbox not available on %s, using no-sandbox mode", runtime.GOOS)
        return &NoOpSandbox{}, nil
    }
}
```
