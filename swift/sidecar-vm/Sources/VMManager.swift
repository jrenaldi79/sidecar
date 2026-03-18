import Foundation
import Virtualization

/// Manages a lightweight VM using Apple's Virtualization.framework.
/// Boots ARM64 Linux from a CoW overlay of the Cowork VM image.
class VMManager: NSObject, VZVirtualMachineDelegate {
    private var vm: VZVirtualMachine?
    private var socketDevice: VZVirtioSocketDevice?

    struct Config {
        let diskImage: String      // Path to CoW overlay image
        let efivars: String        // Path to efivars.fd
        let workspace: String?     // Host directory to mount via VirtioFS
        let ramGB: Int
        let cpus: Int
    }

    /// Configure and boot the VM.
    func boot(config: Config) throws {
        let vmConfig = VZVirtualMachineConfiguration()

        // CPU + RAM
        vmConfig.cpuCount = config.cpus
        vmConfig.memorySize = UInt64(config.ramGB) * 1024 * 1024 * 1024

        // EFI Boot
        let efiStore = VZEFIVariableStore(url: URL(fileURLWithPath: config.efivars))
        vmConfig.bootLoader = VZEFIBootLoader(variableStore: efiStore)

        // Disk (CoW overlay image)
        let diskAttachment = try VZDiskImageStorageDeviceAttachment(
            url: URL(fileURLWithPath: config.diskImage),
            readOnly: false
        )
        vmConfig.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: diskAttachment)]

        // Network (NAT for outbound internet)
        let networkConfig = VZVirtioNetworkDeviceConfiguration()
        networkConfig.attachment = VZNATNetworkDeviceAttachment()
        vmConfig.networkDevices = [networkConfig]

        // VSOCK (host-guest communication, no SSH/NAT needed)
        let socketConfig = VZVirtioSocketDeviceConfiguration()
        vmConfig.socketDevices = [socketConfig]

        // VirtioFS (project directory mount)
        if let workspace = config.workspace {
            let shareConfig = VZVirtioFileSystemDeviceConfiguration(tag: "workspace")
            shareConfig.share = VZSingleDirectoryShare(
                directory: VZSharedDirectory(url: URL(fileURLWithPath: workspace), readOnly: false)
            )
            vmConfig.directorySharingDevices = [shareConfig]
        }

        // Serial console (for provisioning before VSOCK is ready)
        let serialPort = VZVirtioConsoleDeviceSerialPortConfiguration()
        serialPort.attachment = VZFileHandleSerialPortAttachment(
            fileHandleForReading: FileHandle.standardInput,
            fileHandleForWriting: FileHandle.standardError
        )
        vmConfig.serialPorts = [serialPort]

        try vmConfig.validate()

        let virtualMachine = VZVirtualMachine(configuration: vmConfig)
        virtualMachine.delegate = self
        self.vm = virtualMachine
        self.socketDevice = virtualMachine.socketDevices.first as? VZVirtioSocketDevice

        virtualMachine.start { result in
            switch result {
            case .success:
                fputs("VM_STARTED\n", stdout)
                fflush(stdout)
            case .failure(let error):
                fputs("ERROR: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
    }

    /// Request graceful ACPI shutdown.
    func shutdown() {
        guard let vm = self.vm else { return }
        if vm.canRequestStop {
            do {
                try vm.requestStop()
            } catch {
                fputs("Shutdown error: \(error.localizedDescription)\n", stderr)
            }
        }
    }

    // MARK: - VZVirtualMachineDelegate

    func virtualMachine(_ vm: VZVirtualMachine, didStopWithError error: Error) {
        fputs("VM stopped with error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

    func guestDidStop(_ vm: VZVirtualMachine) {
        fputs("VM_STOPPED\n", stdout)
        fflush(stdout)
        exit(0)
    }
}
