import { App } from 'obsidian'
import React from 'react'

import NeuralComposerPlugin from '../../../main'

import { ChatModelsSubSection } from './models/ChatModelsSubSection'
import { EmbeddingModelsSubSection } from './models/EmbeddingModelsSubSection'

type ModelsSectionProps = {
  app: App
  plugin: NeuralComposerPlugin
}

export function ModelsSection({ app, plugin }: ModelsSectionProps) {
  return (
    <div className="nrlcmp-settings-section">
      <div className="nrlcmp-settings-header">Models</div>
      <ChatModelsSubSection app={app} plugin={plugin} />
      <EmbeddingModelsSubSection app={app} plugin={plugin} />
    </div>
  )
}
