import Foundation

let args = CommandLine.arguments

guard args.count >= 2 else {
    fputs("Usage: sidecar-vm <boot|shutdown|status|list> [options]\n", stderr)
    fputs("\nCommands:\n", stderr)
    fputs("  boot       Boot a VM with the specified disk image\n", stderr)
    fputs("  shutdown   Gracefully stop the running VM\n", stderr)
    fputs("  status     Check if a VM is running\n", stderr)
    fputs("  list       List all running sidecar VMs\n", stderr)
    fputs("\nBoot options:\n", stderr)
    fputs("  --disk <path>       Path to disk image (required)\n", stderr)
    fputs("  --efivars <path>    Path to EFI variables file (required)\n", stderr)
    fputs("  --workspace <path>  Host directory to mount via VirtioFS\n", stderr)
    fputs("  --ram <GB>          RAM in GB (default: 2)\n", stderr)
    fputs("  --cpus <N>          CPU cores (default: 2)\n", stderr)
    exit(1)
}

let command = args[1]
let manager = VMManager()

switch command {
case "boot":
    var diskImage = ""
    var efivars = ""
    var workspace: String? = nil
    var ram = 2
    var cpus = 2

    var i = 2
    while i < args.count {
        switch args[i] {
        case "--disk":
            i += 1
            guard i < args.count else {
                fputs("Error: --disk requires a value\n", stderr)
                exit(1)
            }
            diskImage = args[i]
        case "--efivars":
            i += 1
            guard i < args.count else {
                fputs("Error: --efivars requires a value\n", stderr)
                exit(1)
            }
            efivars = args[i]
        case "--workspace":
            i += 1
            guard i < args.count else {
                fputs("Error: --workspace requires a value\n", stderr)
                exit(1)
            }
            workspace = args[i]
        case "--ram":
            i += 1
            guard i < args.count else {
                fputs("Error: --ram requires a value\n", stderr)
                exit(1)
            }
            ram = Int(args[i]) ?? 2
        case "--cpus":
            i += 1
            guard i < args.count else {
                fputs("Error: --cpus requires a value\n", stderr)
                exit(1)
            }
            cpus = Int(args[i]) ?? 2
        default:
            fputs("Unknown option: \(args[i])\n", stderr)
            exit(1)
        }
        i += 1
    }

    guard !diskImage.isEmpty else {
        fputs("Error: --disk is required\n", stderr)
        exit(1)
    }
    guard !efivars.isEmpty else {
        fputs("Error: --efivars is required\n", stderr)
        exit(1)
    }

    let config = VMManager.Config(
        diskImage: diskImage,
        efivars: efivars,
        workspace: workspace,
        ramGB: ram,
        cpus: cpus
    )

    do {
        try manager.boot(config: config)
        // Keep process alive while VM runs
        RunLoop.main.run()
    } catch {
        fputs("Boot failed: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

case "shutdown":
    // TODO: Signal running VM process to shut down
    manager.shutdown()

case "status":
    // TODO: Check for running VM process via PID file
    print("STATUS: unknown")

case "list":
    // TODO: List running VM processes via PID files
    print("[]")

default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
}
