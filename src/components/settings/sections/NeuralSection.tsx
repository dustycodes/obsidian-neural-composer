import { Setting, Notice } from 'obsidian';
import { EnvEditorModal } from '../../modals/EnvEditorModal';
import { useEffect, useRef, useState } from 'react';
import NeuralComposerPlugin from '../../../main';

export const NeuralSection = ({ plugin }: { plugin: NeuralComposerPlugin }) => {
  const settingsRef = useRef<HTMLDivElement>(null);
  
  // Local state for immediate UI reactivity
  const [currentRerankBinding, setCurrentRerankBinding] = useState(plugin.settings.lightRagRerankBinding);
  const [useCustomOntology, setUseCustomOntology] = useState(plugin.settings.useCustomEntityTypes);

  useEffect(() => {
    if (!settingsRef.current) return;
    settingsRef.current.empty();
    const container = settingsRef.current;

    container.createEl('h3', { text: '🧠 Neural backend (LightRAG)' });

    // 1. Auto-start
    new Setting(container)
      .setName('Auto-start LightRAG server')
      .setDesc('Automatically start the server when Obsidian opens.')
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.enableAutoStartServer)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, enableAutoStartServer: value });
          }),
      );

    // 2. Paths
    new Setting(container)
      .setName('LightRAG command path')
      .setDesc('Absolute path to the executable (e.g., lightrag-server.exe).')
      .addText((text) =>
        text
          .setPlaceholder('D:\\...\\lightrag-server.exe')
          .setValue(plugin.settings.lightRagCommand)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagCommand: value });
          }),
      );

    new Setting(container)
      .setName('Graph data directory')
      .setDesc('Absolute path to the folder containing your graph data.')
      .addText((text) =>
        text
          .setPlaceholder('D:\\...\\cora_graph_memory')
          .setValue(plugin.settings.lightRagWorkDir)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagWorkDir: value });
            await plugin.updateEnvFile(); 
          }),
      );

    // 3. Graph Logic Model
    new Setting(container)
      .setName('Graph logic model (LLM)')
      .setDesc('Select the model LightRAG will use for indexing/reasoning.')
      .addDropdown((dropdown) => {
        plugin.settings.chatModels.forEach((model) => {
          dropdown.addOption(model.id, `${model.providerId} - ${model.model}`);
        });
        dropdown.addOption('', 'Same as chat model (default)');
        dropdown.setValue(plugin.settings.lightRagModelId || '');
        dropdown.onChange(async (value) => {
          await plugin.setSettings({ ...plugin.settings, lightRagModelId: value });
          await plugin.updateEnvFile();
        });
      });

    // 3.5 Graph Embedding Model
    new Setting(container)
      .setName('Graph embedding model')
      .setDesc('Select the model used for vectorizing your notes. (Must match the dimensions used during ingestion).')
      .addDropdown((dropdown) => {
        plugin.settings.embeddingModels.forEach((model) => {
          dropdown.addOption(model.id, `${model.providerId} - ${model.model} (${model.dimension || '?'} dim)`);
        });
        
        dropdown.addOption('', 'Same as chat model (default)');
        dropdown.setValue(plugin.settings.lightRagEmbeddingModelId || '');

        dropdown.onChange(async (value) => {
          await plugin.setSettings({
            ...plugin.settings,
            lightRagEmbeddingModelId: value,
          });
           await plugin.updateEnvFile(); 
        });
      });

    // 4. Language
    new Setting(container)
      .setName('Summary language')
      .setDesc('Language used by LightRAG for internal summaries.')
      .addText((text) =>
        text
          .setPlaceholder('English')
          .setValue(plugin.settings.lightRagSummaryLanguage)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagSummaryLanguage: value });
            await plugin.updateEnvFile();
          }),
      );

    // 5. Citations
    new Setting(container)
      .setName('Show citations in chat')
      .setDesc('If enabled, the AI will add footnotes like [1] linking to sources.')
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.settings.lightRagShowCitations)
          .onChange(async (value) => {
            await plugin.setSettings({ ...plugin.settings, lightRagShowCitations: value });
          }),
      );

    // --- ONTOLOGY SECTION ---
    container.createEl('h4', { text: '🧬 Ontology (categories)' });

    new Setting(container)
      .setName('Use custom entity types')
      .setDesc('Enable to define your own knowledge categories. Disable to use LightRAG defaults.')
      .addToggle((toggle) =>
        toggle
          .setValue(useCustomOntology)
          .onChange(async (value) => {
            await plugin.setSettings({
              ...plugin.settings,
              useCustomEntityTypes: value,
            });
            setUseCustomOntology(value); 
            await plugin.updateEnvFile();
          }),
      );

    // CONDITIONAL ONTOLOGY BLOCK
    if (useCustomOntology) {
        const warningDiv = container.createDiv({ cls: 'nrlcmp-setting-warning' });
        
        warningDiv.createEl('strong', { text: '⚠️ CRITICAL WARNING:' });
        warningDiv.createEl('br');
        warningDiv.createSpan({ text: 'Changing Entity Types fundamentally alters how the Graph is built.' });
        warningDiv.createEl('br');
        warningDiv.createSpan({ text: 'If you already have data ingested, you ' });
        warningDiv.createEl('strong', { text: 'MUST delete your Graph Data folder' });
        warningDiv.createSpan({ text: ' and re-ingest all documents.' });

        new Setting(container)
          .setName('Ontology source folder')
          .setDesc('Folder with representative notes to analyze.')
          .addText((text) =>
            text
              .setPlaceholder('Main/Memories')
              .setValue(plugin.settings.lightRagOntologyFolder)
              .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagOntologyFolder: value });
              }),
          );

        let typesTextArea: HTMLTextAreaElement;
        
        new Setting(container)
          .setName('Entity types definition')
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
          );

        const textAreaContainer = container.createDiv({ cls: 'nrlcmp-textarea-container' });
        typesTextArea = textAreaContainer.createEl('textarea', { cls: 'nrlcmp-setting-textarea' });
        typesTextArea.value = plugin.settings.lightRagEntityTypes;
        typesTextArea.onchange = async (e) => {
            const target = e.target as HTMLTextAreaElement;
            await plugin.setSettings({ ...plugin.settings, lightRagEntityTypes: target.value });
            await plugin.updateEnvFile();
        };
    }

    // --- RERANKING SECTION ---
    container.createEl('h4', { text: '🎯 Reranking (Precision)' });

    new Setting(container)
      .setName('Rerank provider')
      .setDesc('Service to re-order results. Use "Custom" for local servers (e.g. vLLM, TEI).')
      .addDropdown((dropdown) => {
        dropdown.addOption('', 'None (Disabled)');
        dropdown.addOption('jina', 'Jina AI');
        dropdown.addOption('cohere', 'Cohere');
        dropdown.addOption('custom', 'Custom / Local');
        
        dropdown.setValue(currentRerankBinding === 'jina' || currentRerankBinding === 'cohere' ? currentRerankBinding : (currentRerankBinding ? 'custom' : ''));
        
        dropdown.onChange(async (value) => {
          const newModel = value === 'jina' ? 'jina-reranker-v2-base-multilingual' : 
                           value === 'cohere' ? 'rerank-v3.5' : 
                           plugin.settings.lightRagRerankModel; 

          await plugin.setSettings({
            ...plugin.settings,
            lightRagRerankBinding: value,
            lightRagRerankModel: newModel
          });
          await plugin.updateEnvFile();
          setCurrentRerankBinding(value); 
        });
      });

    if (currentRerankBinding && currentRerankBinding !== '') {
        
        // 1. MODEL
        new Setting(container)
        .setName('Rerank model')
        .setDesc('E.g. "BAAI/bge-reranker-v2-m3" for local.')
        .addText((text) =>
            text
            .setPlaceholder('Model Name')
            .setValue(plugin.settings.lightRagRerankModel)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankModel: value });
                await plugin.updateEnvFile();
            })
        );

        // 2. API KEY
        new Setting(container)
        .setName('Rerank API key')
        .setDesc('Leave empty for local open servers.')
        .addText((text) =>
            text
            .setPlaceholder('sk-...')
            .setValue(plugin.settings.lightRagRerankApiKey)
            .onChange(async (value) => {
                await plugin.setSettings({ ...plugin.settings, lightRagRerankApiKey: value });
                await plugin.updateEnvFile();
            })
        );
        
        // 3. HOST URL
        if (currentRerankBinding === 'custom') {
             new Setting(container)
            .setName('Local/Custom host URL')
            .setDesc('The full URL to the rerank endpoint (e.g. http://localhost:8000/v1/rerank).')
            .addText((text) =>
                text
                .setPlaceholder('http://localhost:8000/v1/rerank')
                .setValue(plugin.settings.lightRagRerankHost || '') 
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagRerankHost: value });
                    await plugin.updateEnvFile();
                })
            );
            
            // 4. BINDING
             new Setting(container)
            .setName('Binding type')
            .setDesc('Internal binding type for LightRAG (usually "cohere" for compatible local APIs).')
            .addText((text) =>
                text
                .setPlaceholder('cohere')
                .setValue(plugin.settings.lightRagRerankBindingType || 'cohere') 
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagRerankBindingType: value });
                    await plugin.updateEnvFile();
                })
            );
        }
    }

    // --- ADVANCED ENV SECTION ---
    container.createEl('h4', { text: '⚙️ Advanced configuration (Total Control)' });
    
    const details = container.createEl('details');
    details.createEl('summary', { text: 'Edit Custom .env Variables' }).style.cursor = 'pointer';
    const advancedContainer = details.createDiv({ cls: 'nrlcmp-advanced-container' });

    advancedContainer.createEl('p', { 
        text: 'Variables defined here will be appended to the .env file and will OVERRIDE any plugin defaults. Use this for advanced tuning (Context limits, Timeouts, Chunking strategies).',
        cls: 'setting-item-description'
    });

    // ENV TEXT AREA
    new Setting(advancedContainer)
        .setClass('nrlcmp-env-setting')
        .addTextArea(text => {
            text
                .setPlaceholder('MAX_TOTAL_TOKENS=30000\nLLM_TIMEOUT=180\n...')
                .setValue(plugin.settings.lightRagCustomEnv)
                .onChange(async (value) => {
                    await plugin.setSettings({ ...plugin.settings, lightRagCustomEnv: value });
                });
            text.inputEl.addClass('nrlcmp-env-textarea');
        });

    // TEMPLATE BUTTON
    new Setting(advancedContainer)
        .setName('Load full configuration template')
        .setDesc('Paste the full list of available LightRAG variables (commented out) into the box above.')
        .addButton(btn => btn
            .setButtonText('📥 Insert Template')
            .onClick(async () => {
                // Replaced confirm() with a safer approach
                // Since this is inside a React hook, we can't easily await a Modal. 
                // We'll use a simple Notice to warn user if they clicked by mistake, but we apply it.
                // Ideally, implement a proper React/Obsidian Modal bridge.
                if (plugin.settings.lightRagCustomEnv.length > 50) {
                     new Notice("Overwriting existing custom configuration...");
                }
                
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
                await plugin.setSettings({ ...plugin.settings, lightRagCustomEnv: template });
                
                const ta = advancedContainer.querySelector('textarea');
                if(ta) ta.value = template;
            })
        );

    // 7. RESTART BUTTON (EMPHASIS)
    new Setting(container)
      .setName('⚠️ Apply Changes & Restart')
      .setDesc('You MUST restart the server after changing ANY setting above to apply the new configuration (.env).')
      .setClass('nrlcmp-restart-setting') // CSS Class instead of inline styles
      .addButton((button) =>
        button
          .setButtonText('Restart Server Now')
          .setCta()
          .onClick(async () => {
            new Notice("Restarting server...");
            await plugin.restartLightRagServer();
          }),
      );

    // 8. ENV EDITOR MODAL
    new Setting(container)
      .setName('Server configuration')
      .setDesc('Review the generated .env file, tweak advanced parameters, and restart the server.')
      .addButton((button) =>
        button
          .setButtonText('⚙️ Review .env & Restart')
          .setCta()
          .onClick(() => {
            new EnvEditorModal(plugin.app, plugin).open();
          }),
      );

    // VISUALIZATION
    container.createEl('h4', { text: '🎨 Visualization' });

    new Setting(container)
      .setName('Graph rendering engine')
      .setDesc('Choose 2D for performance/clarity or 3D for immersion (requires GPU).')
      .addDropdown((dropdown) => {
        dropdown.addOption('2d', '2D - Fast & Clean');
        dropdown.addOption('3d', '3D - Immersive - uses GPU');
        dropdown.setValue(plugin.settings.graphViewMode);
        dropdown.onChange(async (value) => {
          await plugin.setSettings({
            ...plugin.settings,
            graphViewMode: value as '2d' | '3d',
          });
        });
      });

  }, [plugin.settings, currentRerankBinding, useCustomOntology]);
  
  return <div ref={settingsRef} />;
};