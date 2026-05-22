// File System Access API のうち、標準 lib.dom に未収録の部分を補う。
export {};

declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor?: {
      mode?: "read" | "readwrite";
    }): Promise<PermissionState>;
    requestPermission?(descriptor?: {
      mode?: "read" | "readwrite";
    }): Promise<PermissionState>;
  }

  interface Window {
    showDirectoryPicker?(options?: {
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}
