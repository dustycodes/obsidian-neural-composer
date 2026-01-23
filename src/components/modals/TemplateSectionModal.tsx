import { App } from 'obsidian'

import { ReactModal } from '../common/ReactModal'
import { TemplateSection } from '../settings/sections/TemplateSection'

type TemplateSectionProps = {
  app: App
}

export class TemplateSectionModal extends ReactModal<TemplateSectionProps> {
  constructor(app: App) {
    super({
      app: app,
      Component: TemplateSection,
      props: {
        app,
      },
    })
    // Fix: Use setCssProps instead of direct style manipulation
    this.modalEl.setCssProps({ width: '720px' })
  }
}