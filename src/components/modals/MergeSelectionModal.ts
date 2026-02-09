import { App, Modal, ButtonComponent } from 'obsidian';

export class MergeSelectionModal extends Modal {
  private selectedNodes: string[];
  private onSubmit: (target: string, sources: string[]) => Promise<void>;
  private selectedTarget: string;

  constructor(app: App, nodes: string[], onSubmit: (target: string, sources: string[]) => Promise<void>) {
    super(app);
    this.selectedNodes = nodes;
    this.onSubmit = onSubmit;
    this.selectedTarget = nodes[0]; // Default selection
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Merge entities' });
    
    // 1. Instrucción Principal
    contentEl.createEl('p', { 
        text: 'Select the primary entity (the survivor). All other selected entities will be merged into this one and deleted.',
        cls: 'nrlcmp-merge-instruction'
    });

    // 2. Caja de Advertencia
    const warningBox = contentEl.createDiv({ cls: 'nrlcmp-merge-warning' });
    
    warningBox.createEl("strong", { text: "⚠️ Note: " });
    warningBox.createSpan({ text: "This action " });
    warningBox.createEl("strong", { text: "cannot be undone" });
    warningBox.createSpan({ text: "." });
    warningBox.createEl("br");
    warningBox.createSpan({ text: "Merging nodes with a high number of relations involves heavy processing and " });
    warningBox.createEl("strong", { text: "may take a while" });
    warningBox.createSpan({ text: ". Please be patient." });

    // 3. Lista de Selección
    const listContainer = contentEl.createDiv({ cls: 'nrlcmp-merge-list' });

    // Referencia al botón para actualizarlo dinámicamente
    let submitButton: ButtonComponent;

    this.selectedNodes.forEach((node) => {
        const row = listContainer.createDiv({ cls: 'nrlcmp-merge-item' });
        
        const rbId = `rb-${node.replace(/\s+/g, '-')}`; // Safe ID
        const rb = row.createEl('input', { 
            type: 'radio', 
            attr: { name: 'merge-target' } 
        });
        
        rb.id = rbId;
        rb.value = node;
        if (node === this.selectedTarget) rb.checked = true;
        rb.addClass('nrlcmp-merge-radio');

        // --- REACTIVIDAD DEL BOTÓN ---
        rb.onchange = () => { 
            this.selectedTarget = node;
            if (submitButton) {
                submitButton.setButtonText(`Merge into "${node}"`);
            }
        };

        const label = row.createEl('label', { text: node });
        label.htmlFor = rbId;
        label.addClass('nrlcmp-merge-label');
    });

    // 4. Botonera
    const buttonDiv = contentEl.createDiv({ cls: 'nrlcmp-merge-actions' });

    const cancelBtn = new ButtonComponent(buttonDiv)
        .setButtonText('Cancel')
        .onClick(() => this.close());

    submitButton = new ButtonComponent(buttonDiv)
        .setButtonText(`Merge into "${this.selectedTarget}"`)
        .setCta()
        .onClick(() => {
            // Wrapped async logic to satisfy linter (void return expected)
            void (async () => {
                // Estado de carga
                submitButton.setButtonText('Merging...').setDisabled(true);
                cancelBtn.setDisabled(true);
                
                try {
                    const sources = this.selectedNodes.filter(n => n !== this.selectedTarget);
                    await this.onSubmit(this.selectedTarget, sources);
                    this.close();
                } catch (error) {
                    console.error("Merge failed", error);
                    // Restaurar estado en caso de error para permitir reintento o cancelación
                    // Fix: Sentence case "Retry merge"
                    submitButton.setButtonText('Retry merge').setDisabled(false);
                    cancelBtn.setDisabled(false);
                }
            })();
        });
  }

  onClose() {
    this.contentEl.empty();
  }
}