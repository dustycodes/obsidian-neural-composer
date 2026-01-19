import { TFile, View, WorkspaceLeaf } from 'obsidian'
import { Root, createRoot } from 'react-dom/client'

import ApplyViewRoot from './components/apply-view/ApplyViewRoot'
import { APPLY_VIEW_TYPE } from './constants'
import { AppProvider } from './contexts/app-context'

export type ApplyViewState = {
  file: TFile
  originalContent: string
  newContent: string
}

export class ApplyView extends View {
  private root: Root | null = null

  private state: ApplyViewState | null = null

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType() {
    return APPLY_VIEW_TYPE
  }

  getDisplayText() {
    return `Applying: ${this.state?.file?.name ?? ''}`
  }

  setState(state: ApplyViewState): Promise<void> {
    this.state = state
    this.render()
    return Promise.resolve(); // Cumples el contrato
  }

  onOpen(): Promise<void> {
    this.root = createRoot(this.containerEl);
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.root?.unmount();
    return Promise.resolve();
  }

  render() {
    if (!this.root || !this.state) return
    this.root.render(
      <AppProvider app={this.app}>
        <ApplyViewRoot state={this.state} close={() => this.leaf.detach()} />
      </AppProvider>,
    )
  }
}
