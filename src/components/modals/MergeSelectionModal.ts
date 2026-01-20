import { App, Modal, ButtonComponent } from 'obsidian';

export class MergeSelectionModal extends Modal {
  private selectedNodes: string[];
  private onSubmit: (target: string, sources: string[]) => Promise<void>;
  private selectedTarget: string;

  constructor(app: App, nodes: string[], onSubmit: (target: string, sources: string[]) => Promise<void>) {
    super(app);
    this.selectedNodes = nodes;
    this.onSubmit = onSubmit;
    this.selectedTarget = nodes[0]; // Default
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: '🔗 Merge entities' });
    
    // 1. Instrucción Principal (CSS Class)
    contentEl.createEl('p', { 
        text: 'Select the *primary* entity (the survivor). All other selected entities will be merged into this one and deleted.',
        cls: 'nrlcmp-merge-instruction'
    });

    // 2. Caja de Advertencia (CSS Class)
    const warningBox = contentEl.createDiv();
    warningBox.addClass('nrlcmp-merge-warning');
    
    // Contenido seguro (sin variables sin usar)
    warningBox.createEl("strong", { text: "⚠️ Note: " });
    warningBox.createSpan({ text: "This action " });
    warningBox.createEl("strong", { text: "Cannot be undone" });
    warningBox.createSpan({ text: "." });
    warningBox.createEl("br");
    warningBox.createSpan({ text: "Merging nodes with a high number of relations involves heavy processing and " });
    warningBox.createEl("strong", { text: "May take a while" });
    warningBox.createSpan({ text: ". Please be patient." });

    // 3. Lista (CSS Class)
    const listContainer = contentEl.createDiv();
    listContainer.addClass('nrlcmp-merge-list');

    // Referencia al botón para actualizarlo dinámicamente
    let submitButton: ButtonComponent;

    // Lista de Radio Buttons
    this.selectedNodes.forEach((node) => {
        const row = listContainer.createDiv();
        row.addClass('nrlcmp-merge-item');
        
        const rb = row.createEl('input', { type: 'radio', attr: { name: 'merge-target' } });
        rb.id = `rb-${node}`;
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
        label.htmlFor = `rb-${node}`;
        label.addClass('nrlcmp-merge-label');
    });

    // Botonera (CSS Class)
    const buttonDiv = contentEl.createDiv();
    buttonDiv.addClass('nrlcmp-merge-actions');

    const cancelBtn = new ButtonComponent(buttonDiv)
        .setButtonText('Cancel')
        .onClick(() => this.close());

    submitButton = new ButtonComponent(buttonDiv)
        .setButtonText(`Merge into "${this.selectedTarget}"`)
        .setCta() // Azul brillante
        .onClick(async () => {
            // 1. ESTADO DE CARGA
            submitButton.setButtonText('⏳ Merging...').setDisabled(true);
            cancelBtn.setDisabled(true);
            
            // 2. EJECUTAR ACCIÓN
            const sources = this.selectedNodes.filter(n => n !== this.selectedTarget);
            await this.onSubmit(this.selectedTarget, sources);
            
            // 3. CERRAR
            this.close();
        });
  }

  onClose() {
    this.contentEl.empty();
  }
}