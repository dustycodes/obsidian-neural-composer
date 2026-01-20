import { Setting } from 'obsidian'
import { EnvEditorModal } from '../../modals/EnvEditorModal'
import { useEffect, useRef, useState } from 'react'

import NeuralComposerPlugin from '../../../main'

export const NeuralSection = ({ plugin }: { plugin: NeuralComposerPlugin }) => {
  const settingsRef = useRef<HTMLDivElement>(null)
  
  // Estados locales para reactividad inmediata en la UI
  const [currentRerankBinding, setCurrentRerankBinding] = useState(plugin.settings.lightRagRerankBinding)
  const [useCustomOntology, setUseCustomOntology] = useState(plugin.settings.useCustomEntityTypes)

  useEffect(() => {
    if (!settingsRef.current) return
    settingsRef.current.empty()
    const container = settingsRef.current

    container.createEl('h3', { text: '🧠 Neural backend (LightRAG)' })

    // 1. Auto-start
    new Setting(container)
      .setName('Auto-start LightRAG server')
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
      .setName('LightRAG command path')
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
      .setName('Graph data directory')
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
      .setName('Graph logic model (LLM)')
      .setDesc('Select the model LightRAG will use for indexing/reasoning.')
      .addDropdown((dropdown) => {
        plugin.settings.chatModels.forEach((model) => {
          dropdown.addOption(model.id, `${model.providerId} - ${model.model}`)
        })
        dropdown.addOption('', 'Same as chat model (default)')
        dropdown.setValue(plugin.settings.lightRagModelId || '')
        dropdown.onChange(async (value) => {
          await plugin.setSettings({ ...plugin.settings, lightRagModelId: value })
          await plugin.updateEnvFile()
        })
      })

// 3.5 Graph Embedding Model (NUEVO)
    new Setting(container)
      .setName('Graph Embedding Model')
      .setDesc('Select the model used for vectorizing your notes. (Must match the dimensions used during ingestion).')
      .addDropdown((dropdown) => {
        // Llenar lista con modelos de embedding disponibles
        plugin.settings.embeddingModels.forEach((model) => {
          dropdown.addOption(model.id, `${model.providerId} - ${model.model} (${model.dimension || '?'} dim)`)
        })
        
        // Opción por defecto
        dropdown.addOption('', 'Same as Chat Model (Default)')
        
        // Valor actual
        dropdown.setValue(plugin.settings.lightRagEmbeddingModelId || '')

        dropdown.onChange(async (value) => {
          await plugin.setSettings({
            ...plugin.settings,
            lightRagEmbeddingModelId: value,
          })
           await plugin.updateEnvFile(); 
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
      .setName('Show citations in chat')
      .setDesc('If enabled, the AI will add footnotes like [1] linking to sources.')
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.lightRagShowCitations)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagShowCitations: value })
          }),
      )

    // --- SECCIÓN ONTOLOGÍA ---
    container.createEl('h4', { text: '🧬 Ontology (categories)' })

    new Setting(container)
      .setName('Use Custom Entity Types')
      .setDesc('Enable to define your own knowledge categories.Disable to use LightRAG defaults:Person, Creature, Organization, Location, Event, Concept, Method, Content, Data, Artifact, NaturalObject.')
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
        
        // --- CORRECCIÓN SEGURA ---
        const wTitle = warningDiv.createEl('strong', { text: '⚠️ CRITICAL WARNING:' });
        warningDiv.createEl('br');
        warningDiv.createSpan({ text: 'Changing Entity Types fundamentally alters how the Graph is built.' });
        warningDiv.createEl('br');
        warningDiv.createSpan({ text: 'If you already have data ingested, you ' });
        warningDiv.createEl('strong', { text: 'MUST delete your Graph Data folder' });
        warningDiv.createSpan({ text: ' and re-ingest all documents.' });
        // -------------------------

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

    // --- SECCIÓN RERANKING (AVANZADA) ---
    container.createEl('h4', { text: '🎯 Reranking (Precision)' })

    new Setting(container)
      .setName('Rerank Provider')
      .setDesc('Service to re-order results. Use "Custom" for local servers (e.g. vLLM, TEI).')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'None (Disabled)')
        dropdown.addOption('jina', 'Jina AI')
        dropdown.addOption('cohere', 'Cohere')
        dropdown.addOption('custom', 'Custom / Local') // <--- NUEVA OPCIÓN
        
        dropdown.setValue(currentRerankBinding === 'jina' || currentRerankBinding === 'cohere' ? currentRerankBinding : (currentRerankBinding ? 'custom' : ''))
        
        dropdown.onChange(async (value) => {
          // Si es custom, no sobreescribimos el modelo inmediatamente
          const newModel = value === 'jina' ? 'jina-reranker-v2-base-multilingual' : 
                           value === 'cohere' ? 'rerank-v3.5' : 
                           plugin.settings.lightRagRerankModel; 

          await plugin.setSettings({
            ...plugin.settings,
            lightRagRerankBinding: value,
            lightRagRerankModel: newModel
          })
          await plugin.updateEnvFile()
          setCurrentRerankBinding(value) 
        })
      })

    // MOSTRAR CAMPOS SEGÚN SELECCIÓN
    if (currentRerankBinding && currentRerankBinding !== '') {
        
        // 1. MODELO (Siempre visible)
        new Setting(container)
        .setName('Rerank Model')
        .setDesc('E.g. "BAAI/bge-reranker-v2-m3" for local.')
        .addText((text) =>
            text
            .setPlaceholder('Model Name')
            .setValue(plugin.settings.lightRagRerankModel)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankModel: value })
                await plugin.updateEnvFile()
            })
        )

        // 2. API KEY (Solo para Jina/Cohere/Custom con Auth)
        new Setting(container)
        .setName('Rerank API Key')
        .setDesc('Leave empty for local open servers.')
        .addText((text) =>
            text
            .setPlaceholder('sk-...')
            .setValue(plugin.settings.lightRagRerankApiKey)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankApiKey: value })
                await plugin.updateEnvFile()
            })
        )
        
        // 3. HOST URL (Solo para Custom)
        if (currentRerankBinding === 'custom') {
             new Setting(container)
            .setName('Local/Custom Host URL')
            .setDesc('The full URL to the rerank endpoint (e.g. http://localhost:8000/v1/rerank).')
            .addText((text) =>
                text
                .setPlaceholder('http://localhost:8000/v1/rerank')
                // Usamos un campo temporal en settings o reutilizamos uno existente?
                // Mejor creemos uno nuevo en settings.types.ts (ver paso abajo)
                .setValue(plugin.settings.lightRagRerankHost || '') 
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagRerankHost: value })
                    await plugin.updateEnvFile()
                })
            )
            
            // 4. BINDING REAL (Solo para Custom)
            // LightRAG necesita saber qué "tipo" de API es (cohere-compatible, transformer, etc)
             new Setting(container)
            .setName('Binding Type')
            .setDesc('Internal binding type for LightRAG (usually "cohere" for compatible local APIs).')
            .addText((text) =>
                text
                .setPlaceholder('cohere')
                .setValue(plugin.settings.lightRagRerankBindingType || 'cohere') 
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagRerankBindingType: value })
                    await plugin.updateEnvFile()
                })
            )
        }
    }

    // --- SECCIÓN: ADVANCED ENVIRONMENT CONFIGURATION ---
    container.createEl('h4', { text: '⚙️ Advanced Configuration (Total Control)' });
    
    const details = container.createEl('details');
    details.createEl('summary', { text: 'Edit Custom .env Variables' }).style.cursor = 'pointer';
    const advancedContainer = details.createDiv();
    advancedContainer.style.paddingLeft = '10px';
    advancedContainer.style.borderLeft = '2px solid var(--interactive-accent)';
    advancedContainer.style.marginTop = '10px';

    advancedContainer.createEl('p', { 
        text: 'Variables defined here will be appended to the .env file and will OVERRIDE any plugin defaults. Use this for advanced tuning (Context limits, Timeouts, Chunking strategies).',
        cls: 'setting-item-description'
    });

    // TEXT AREA DE CONFIGURACIÓN
    const envTextArea = new Setting(advancedContainer)
        .setClass('neural-env-textarea') // Clase para CSS si quieres
        .addTextArea(text => {
            text
                .setPlaceholder('MAX_TOTAL_TOKENS=30000\nLLM_TIMEOUT=180\n...')
                .setValue(plugin.settings.lightRagCustomEnv)
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagCustomEnv: value });
                    // No reiniciamos todavía, el usuario debe dar click al botón final
                });
            text.inputEl.rows = 10;
            text.inputEl.style.width = '100%';
            text.inputEl.style.fontFamily = 'monospace';
            text.inputEl.style.fontSize = '0.85em';
            text.inputEl.style.whiteSpace = 'pre';
        });

    // BOTÓN PARA CARGAR PLANTILLA
    new Setting(advancedContainer)
        .setName('Load Full Configuration Template')
        .setDesc('Paste the full list of available LightRAG variables (commented out) into the box above.')
        .addButton(btn => btn
            .setButtonText('📥 Insert Template')
            .onClick(async () => {
                if (plugin.settings.lightRagCustomEnv.length > 50 && !confirm("Overwrite current custom config?")) return;
                
                // LA PLANTILLA COMPLETA (Resumida para el chat, pero tú pones todo el contenido del txt)
                const template = `# --- Query Configuration ---
# ENABLE_LLM_CACHE=true
# TOP_K=40
# CHUNK_TOP_K=20
# MAX_TOTAL_TOKENS=30000
# KG_CHUNK_PICK_METHOD=VECTOR

# --- Document Processing ---
# CHUNK_SIZE=1200
# CHUNK_OVERLAP_SIZE=100
# ENABLE_LLM_CACHE_FOR_EXTRACT=true

# --- Timeouts ---
# LLM_TIMEOUT=180
# EMBEDDING_TIMEOUT=30

# --- Storage Selection (Advanced) ---
# LIGHTRAG_KV_STORAGE=JsonKVStorage
# LIGHTRAG_VECTOR_STORAGE=NanoVectorDBStorage
`;
                // Guardar y actualizar UI
                await plugin.setSettings({ ...plugin.settings, lightRagCustomEnv: template });
                // Truco sucio para refrescar el textarea sin reactividad compleja
                const ta = advancedContainer.querySelector('textarea');
                if(ta) ta.value = template;
            })
        );


    // 7. RESTART BUTTON (CON ÉNFASIS VISUAL)
    // Creamos un contenedor estilizado para llamar la atención
    const restartSetting = new Setting(container)
      .setName('⚠️ Apply Changes & Restart')
      .setDesc('You MUST restart the server after changing ANY setting above to apply the new configuration (.env).')
      .addButton((button) =>
        button
          .setButtonText('Restart Server Now')
          .setCta()
          .onClick(async () => {
            await plugin.restartLightRagServer();
          }),
      );



    // 8. ADVANCED CONFIG & RESTART
    new Setting(container)
      .setName('Server Configuration')
      .setDesc('Review the generated .env file, tweak advanced parameters (Chunk size, Async limits), and restart the server.')
      .addButton((button) =>
        button
          .setButtonText('⚙️ Review .env & Restart')
          .setCta()
          .onClick(() => {
            // Abrir el Modal de Edición
            new EnvEditorModal(plugin.app, plugin).open();
          }),
      )


// ... dentro de NeuralSection ...
    container.createEl('h4', { text: '🎨 Visualization' })

    new Setting(container)
      .setName('Graph Rendering Engine')
      .setDesc('Choose 2D for performance/clarity or 3D for immersion (requires GPU).')
      .addDropdown((dropdown) => {
        dropdown.addOption('2d', '2D - Fast & Clean')
        dropdown.addOption('3d', '3D - Immersive - uses GPU')
        dropdown.setValue(plugin.settings.graphViewMode)
        dropdown.onChange(async (value) => {
          await plugin.setSettings({
            ...plugin.settings,
            graphViewMode: value as '2d' | '3d',
          })
        })
      })


    // ESTILO "ZONA DE ATENCIÓN"
    // Aplicamos estilos directamente al elemento del DOM de este setting
    restartSetting.settingEl.style.backgroundColor = 'rgba(255, 165, 0, 0.15)'; // Fondo Naranja suave
    restartSetting.settingEl.style.border = '1px solid var(--color-orange)';     // Borde Naranja
    restartSetting.settingEl.style.borderRadius = '8px';
    restartSetting.settingEl.style.marginTop = '20px';
    restartSetting.settingEl.style.padding = '15px';
    
    // Icono o énfasis en el nombre
    restartSetting.nameEl.style.color = 'var(--text-normal)';
    restartSetting.nameEl.style.fontWeight = 'bold';

  }, [plugin.settings, currentRerankBinding, useCustomOntology])
  
  return <div ref={settingsRef} />
}