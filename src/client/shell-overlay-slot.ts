/**
 * Local SlotMap augmentation for the frame-wide overlay seat.
 *
 * `shell.overlay` is declared by the shell's own slot runtime (it is a live
 * slot: the running GUI reports it with its full registration contract), but
 * the shipped `@deepseek-ai/dsh-client-ui-slots` declarations only describe
 * the product-owned slots, so TypeScript cannot see it. The augmentation
 * mirrors the contract the live slot reports:
 *   kind: list, scope: root,
 *   registration: { id: string (required), order?: number, label?: string | (() => string) }
 *
 * Keep this in step with the live slot: query it with
 * `cordis_inspect_query` (client / Slots / listSubTree, root "shell.overlay").
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Frame-wide floating layer, above every column and outside their scroll containers. */
    'shell.overlay': {
      kind: 'list'
      scope: 'root'
      registration: {
        id: string
        order?: number
        label?: string | (() => string)
      }
    }
  }
}

export {}
