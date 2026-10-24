export interface ObjectUrl {
  create(blob: Blob): string
  revoke(url: string): void
}

export function createBrowserObjectUrl(): ObjectUrl {
  return {
    create: (blob) => URL.createObjectURL(blob),
    revoke: (url) => {
      URL.revokeObjectURL(url)
    },
  }
}
