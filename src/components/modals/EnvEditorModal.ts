import { App, Modal, Setting } from 'obsidian'
import NeuralComposerPlugin from '../../main'

export class EnvEditorModal extends Modal {
  plugin: NeuralComposerPlugin
  envContent: string

  constructor(app: App, plugin: NeuralComposerPlugin) {
    super(app)
    this.plugin = plugin
    // Generamos la configuración propuesta basada en los settings actuales
    this.envContent = this.plugin.generateEnvConfig()
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()

    contentEl.createEl('h2', { text: '⚙️ Advanced server configuration (.env)' })
    
    contentEl.createEl('p', { 
        text: 'This is the generated configuration for LightRAG. You can manually tweak parameters or add custom environment variables here.',
        cls: 'setting-item-description'
    })

    // Área de texto grande para editar
    const textArea = contentEl.createEl('textarea');
    textArea.addClass('nrlcmp-env-textarea');
    textArea.value = this.envContent;
    
    // Capturar cambios
    textArea.oninput = (e) => {
        this.envContent = (e.target as HTMLTextAreaElement).value;
    }

    // Botonera
    const buttonContainer = contentEl.createDiv();
    buttonContainer.addClass('nrlcmp-modal-actions');

    new Setting(buttonContainer)
        .addButton(btn => btn
            .setButtonText('Cancel')
            .onClick(() => this.close())
        )
        .addButton(btn => btn
            .setButtonText('💾 Save & Restart Server')
            .setCta()
            .onClick(async () => {
                await this.plugin.saveEnvAndRestart(this.envContent);
                this.close();
            })
        );
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}