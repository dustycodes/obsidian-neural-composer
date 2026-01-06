import { Setting } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import SmartComposerPlugin from '../../../main'

export const NeuralSection = ({ plugin }: { plugin: SmartComposerPlugin }) => {
  const settingsRef = useRef<HTMLDivElement>(null)
  
  // Estados locales para reactividad inmediata en la UI
  const [currentRerankBinding, setCurrentRerankBinding] = useState(plugin.settings.lightRagRerankBinding)
  const [useCustomOntology, setUseCustomOntology] = useState(plugin.settings.useCustomEntityTypes)

  useEffect(() => {
    if (!settingsRef.current) return
    settingsRef.current.empty()
    const container = settingsRef.current

    container.createEl('h3', { text: '🧠 Neural Backend (LightRAG)' })

    // 1. Auto-start
    new Setting(container)
      .setName('Auto-start LightRAG Server')
      .setDesc('Automatically start the server when Obsidian opens.')
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.enableAutoStartServer)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, enableAutoStartServer: value })
          }),
      )

    // 2. Rutas
    new Setting(container)
      .setName('LightRAG Command Path')
      .setDesc('Absolute path to the executable (e.g., lightrag-server.exe).')
      .addText((text) =>
        text
          .setPlaceholder('D:\\...\\lightrag-server.exe')
          .setValue(plugin.settings.lightRagCommand)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagCommand: value })
          }),
      )

    new Setting(container)
      .setName('Graph Data Directory')
      .setDesc('Absolute path to the folder containing your graph data.')
      .addText((text) =>
        text
          .setPlaceholder('D:\\...\\cora_graph_memory')
          .setValue(plugin.settings.lightRagWorkDir)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagWorkDir: value })
            await plugin.updateEnvFile(); 
          }),
      )

    // 3. Graph Logic Model
    new Setting(container)
      .setName('Graph Logic Model (LLM)')
      .setDesc('Select the model LightRAG will use for indexing/reasoning.')
      .addDropdown((dropdown) => {
        plugin.settings.chatModels.forEach((model) => {
          dropdown.addOption(model.id, `${model.providerId} - ${model.model}`)
        })
        dropdown.addOption('', 'Same as Chat Model (Default)')
        dropdown.setValue(plugin.settings.lightRagModelId || '')
        dropdown.onChange(async (value) => {
          await plugin.setSettings({ ...plugin.settings, lightRagModelId: value })
          await plugin.updateEnvFile()
        })
      })

    // 4. Language
    new Setting(container)
      .setName('Summary Language')
      .setDesc('Language used by LightRAG for internal summaries.')
      .addText((text) =>
        text
          .setPlaceholder('English')
          .setValue(plugin.settings.lightRagSummaryLanguage)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagSummaryLanguage: value })
            await plugin.updateEnvFile()
          }),
      )

    // 5. Citations
    new Setting(container)
      .setName('Show Citations in Chat')
      .setDesc('If enabled, the AI will add footnotes like [1] linking to sources.')
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.lightRagShowCitations)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagShowCitations: value })
          }),
      )

    // --- SECCIÓN ONTOLOGÍA ---
    container.createEl('h4', { text: '🧬 Ontology (Categories)' })

    new Setting(container)
      .setName('Use Custom Entity Types')
      .setDesc('Enable to define your own knowledge categories.<br>Disable to use LightRAG defaults:\nPerson, Creature, Organization, Location, Event, Concept, Method, Content, Data, Artifact, NaturalObject.')
      .addToggle((toggle) =>
        toggle
          .setValue(useCustomOntology)
          .onChange(async (value) => {
            await plugin.setSettings({
              ...plugin.settings,
              useCustomEntityTypes: value,
            })
            setUseCustomOntology(value) 
            await plugin.updateEnvFile()
          }),
      )

    // BLOQUE CONDICIONAL ONTOLOGÍA
    if (useCustomOntology) {
        const warningDiv = container.createDiv();
        warningDiv.style.backgroundColor = 'rgba(255, 69, 0, 0.15)'; 
        warningDiv.style.border = '1px solid var(--text-error)';
        warningDiv.style.borderRadius = '8px';
        warningDiv.style.padding = '12px';
        warningDiv.style.marginBottom = '20px';
        warningDiv.style.color = 'var(--text-normal)';
        warningDiv.style.fontSize = '0.9em';
        
        warningDiv.innerHTML = `
            <strong>⚠️ CRITICAL WARNING:</strong><br>
            Changing Entity Types fundamentally alters how the Graph is built.<br>
            If you already have data ingested, you <strong>MUST delete your Graph Data folder</strong> and re-ingest all documents.<br>
        `;

        new Setting(container)
          .setName('Ontology Source Folder')
          .setDesc('Folder with representative notes to analyze.')
          .addText((text) =>
            text
              .setPlaceholder('Main/Memories')
              .setValue(plugin.settings.lightRagOntologyFolder)
              .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagOntologyFolder: value })
              }),
          )

        // Botón y Textarea
        let typesTextArea: HTMLTextAreaElement;
        
        new Setting(container)
          .setName('Entity Types Definition')
          .setDesc('Define the "Categories" of your field of knowledge.')
          .addButton((button) => 
            button
              .setButtonText('✨ Analyze & Generate')
              .setCta()
              .onClick(async () => {
                 const newTypes = await plugin.generateEntityTypes();
                 if (newTypes && typesTextArea) {
                     typesTextArea.value = newTypes;
                     typesTextArea.dispatchEvent(new Event('change'));
                 }
              })
          )

        const textAreaContainer = container.createDiv();
        textAreaContainer.style.marginBottom = '20px';
        typesTextArea = textAreaContainer.createEl('textarea');
        typesTextArea.style.width = '100%';
        typesTextArea.style.height = '80px';
        typesTextArea.style.fontFamily = 'var(--font-monospace)';
        typesTextArea.style.fontSize = '0.9em';
        typesTextArea.value = plugin.settings.lightRagEntityTypes;
        typesTextArea.onchange = async (e) => {
            const target = e.target as HTMLTextAreaElement;
            await plugin.setSettings({ ...plugin.settings, lightRagEntityTypes: target.value });
            await plugin.updateEnvFile();
        };
    }

    // --- SECCIÓN RERANKING (RESTAURADA) ---
    container.createEl('h4', { text: '🎯 Reranking (Precision)' })

    new Setting(container)
      .setName('Rerank Provider')
      .setDesc('Service to re-order results for better relevance. Leave empty to disable.')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'None (Disabled)')
        dropdown.addOption('jina', 'Jina AI')
        dropdown.addOption('cohere', 'Cohere')
        
        dropdown.setValue(currentRerankBinding)
        
        dropdown.onChange(async (value) => {
          const newModel = value === 'jina' ? 'jina-reranker-v2-base-multilingual' : 
                           value === 'cohere' ? 'rerank-v3.5' : '';
          await plugin.setSettings({
            ...plugin.settings,
            lightRagRerankBinding: value,
            lightRagRerankModel: newModel
          })
          await plugin.updateEnvFile()
          setCurrentRerankBinding(value) 
        })
      })

    // BLOQUE CONDICIONAL RERANKING
    if (currentRerankBinding && currentRerankBinding !== '') {
        new Setting(container)
        .setName('Rerank Model')
        .addText((text) =>
            text
            .setValue(plugin.settings.lightRagRerankModel)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankModel: value })
                await plugin.updateEnvFile()
            })
        )

        new Setting(container)
        .setName('Rerank API Key')
        .setDesc('API Key for the reranking service.')
        .addText((text) =>
            text
            .setPlaceholder('jina_xxx or cohere_xxx')
            .setValue(plugin.settings.lightRagRerankApiKey)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankApiKey: value })
                await plugin.updateEnvFile()
            })
        )
    }

    // 7. RESTART BUTTON
    new Setting(container)
      .setName('Apply Changes & Restart')
      .setDesc('Restart the LightRAG server to apply new configuration settings.')
      .addButton((button) =>
        button
          .setButtonText('Restart Server')
          .setCta()
          .onClick(async () => {
            await plugin.restartLightRagServer();
          }),
      )

  }, [plugin.settings, currentRerankBinding, useCustomOntology])

  return <div ref={settingsRef} />
}