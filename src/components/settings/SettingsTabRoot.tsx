import { App } from 'obsidian'
import NeuralComposerPlugin from '../../main'
import { ObsidianButton } from '../common/ObsidianButton'
import { ObsidianSetting } from '../common/ObsidianSetting'

import { ChatSection } from './sections/ChatSection'
import { EtcSection } from './sections/EtcSection'
import { McpSection } from './sections/McpSection'
import { ModelsSection } from './sections/ModelsSection'
import { ProvidersSection } from './sections/ProvidersSection'
// import { RAGSection } from './sections/RAGSection' // <--- COMENTADO: Ya no usamos el RAG viejo
import { TemplateSection } from './sections/TemplateSection'
import { NeuralSection } from './sections/NeuralSection' 

type SettingsTabRootProps = {
  app: App
  plugin: NeuralComposerPlugin
}

export function SettingsTabRoot({ app, plugin }: SettingsTabRootProps) {
  return (
    <>
      {/* 1. HEADER & IDENTITY */}
      <div style={{ textAlign: 'center', marginBottom: '30px', marginTop: '10px' }}>
        <h1 style={{ marginBottom: '5px', fontSize: '1.8em' }}>Neural Composer</h1>
        <p style={{ opacity: 0.7, marginTop: '0' }}>Graph-Powered Memory for Obsidian</p>
      </div>

      <ObsidianSetting
        name="About & Support"
        desc="Neural Composer connects Obsidian to a local Knowledge Graph via LightRAG."
        heading
      >
        <ObsidianButton
          text="Original Project (Smart Composer)"
          onClick={() => window.open('https://github.com/glowingjade/obsidian-smart-composer', '_blank')}
        />
      </ObsidianSetting>

      {/* 2. INFRAESTRUCTURA (Providers & Models) */}
      {/* El usuario debe configurar esto primero para tener API Keys */}
      <ProvidersSection app={app} plugin={plugin} />
      <ModelsSection app={app} plugin={plugin} />

      {/* 3. CEREBRO (LightRAG) */}
      {/* Aquí vive toda nuestra lógica nueva: Server, Ontology, Rerank */}
      <NeuralSection plugin={plugin} />

      {/* 4. COMPORTAMIENTO (Chat) */}
      <ChatSection />
      
      {/* 5. HERRAMIENTAS AVANZADAS */}
      <TemplateSection app={app} />
      <McpSection app={app} plugin={plugin} />
      
      {/* 6. ZONA DE PELIGRO / EXTRA */}
      <EtcSection app={app} plugin={plugin} />

      {/* OCULTO: RAGSection (El sistema antiguo vector-local) */}
    </>
  )
}