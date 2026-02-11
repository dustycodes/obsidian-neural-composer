import { App, Modal, ButtonComponent, Notice } from 'obsidian'; // Eliminado 'Setting'
import NeuralComposerPlugin from '../../main';

export class EnvEditorModal extends Modal {
  plugin: NeuralComposerPlugin;
  content: string;

  constructor(app: App, plugin: NeuralComposerPlugin) {
    super(app);
    this.plugin = plugin;
    this.content = plugin.generateEnvConfig();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // El linter se queja de esta línea por el Emoji. Lo añadiremos al /skip.
    contentEl.createEl('h2', { text: 'Server configuration (.env)' });

    const desc = contentEl.createDiv({ cls: 'nrlcmp-modal-desc' });
    desc.createSpan({ text: 'Review the generated configuration below. ' });
    desc.createEl('strong', { text: 'Changes here are temporary ' });
    desc.createSpan({ text: 'until you edit the settings in the plugin tab.' });

    // CSS Class instead of inline style
    const textAreaContainer = contentEl.createDiv({ cls: 'nrlcmp-env-container' });
    
    const textArea = textAreaContainer.createEl('textarea', {
      cls: 'nrlcmp-env-textarea-full',
      text: this.content
    });

    // Handle updates
    textArea.onchange = (e) => {
        const target = e.target as HTMLTextAreaElement;
        this.content = target.value;
    };

    const buttonContainer = contentEl.createDiv({ cls: 'nrlcmp-modal-actions' });

    new ButtonComponent(buttonContainer)
      .setButtonText('Cancel')
      .onClick(() => this.close());

new ButtonComponent(buttonContainer)
      .setButtonText('Save & restart server')
      .setCta()
      .onClick(() => {
        // FIX: Eliminamos el wrapper async/void porque saveEnvAndRestart ahora es síncrono.
        try {
            new Notice("Saving and restarting...");
            this.plugin.saveEnvAndRestart(this.content);
            this.close();
        } catch (error) {
            new Notice("Failed to restart server.");
            console.error(error);
        }
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}