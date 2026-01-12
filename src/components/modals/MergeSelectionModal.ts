import { App, Modal, ButtonComponent } from 'obsidian';

export class MergeSelectionModal extends Modal {
  private selectedNodes: string[];
  // Ahora el callback devuelve una Promesa para que podamos esperar
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

    contentEl.createEl('h3', { text: '🔗 Merge Entities' });
    
// 1. Instrucción Principal
    contentEl.createEl('p', { 
        text: 'Select the PRIMARY entity (The Survivor). All other selected entities will be merged into this one and deleted.',
        attr: { style: 'color: var(--text-muted); font-size: 0.9em; margin-bottom: 10px;' }
    });

    // 2. Caja de Advertencia (Más visible)
    const warningBox = contentEl.createDiv();
    warningBox.style.cssText = `
        background-color: rgba(230, 160, 0, 0.15); /* Naranja suave */
        border: 1px solid var(--text-warning);
        border-radius: 5px;
        padding: 8px 12px;
        margin-bottom: 20px;
        font-size: 0.85em;
        color: var(--text-normal);
    `;
    
    // Usamos innerHTML para poner negritas
    warningBox.innerHTML = `
        <strong>⚠️ NOTE:</strong> This action <strong>cannot be undone</strong>.<br>
        Merging nodes with a high number of relations involves heavy processing and <strong>may take a while</strong>. Please be patient.
    `;



    const listContainer = contentEl.createDiv();
    listContainer.style.maxHeight = '300px';
    listContainer.style.overflowY = 'auto';
    listContainer.style.marginBottom = '20px';
    listContainer.style.border = '1px solid var(--background-modifier-border)';
    listContainer.style.borderRadius = '6px';
    listContainer.style.padding = '10px';
    listContainer.style.backgroundColor = 'var(--background-secondary)';

    // Referencia al botón para actualizarlo dinámicamente
    let submitButton: ButtonComponent;

    // Lista de Radio Buttons
    this.selectedNodes.forEach((node) => {
        const row = listContainer.createDiv();
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '8px';
        row.style.gap = '10px';
        row.style.borderBottom = '1px solid var(--background-modifier-border)';
        
        const rb = row.createEl('input', { type: 'radio', attr: { name: 'merge-target' } });
        rb.id = `rb-${node}`;
        rb.value = node;
        if (node === this.selectedTarget) rb.checked = true;
        rb.style.cursor = 'pointer';

        // --- REACTIVIDAD DEL BOTÓN ---
        rb.onchange = () => { 
            this.selectedTarget = node;
            // Actualizamos el texto del botón al cambiar la selección
            if (submitButton) {
                submitButton.setButtonText(`Merge into "${node}"`);
            }
        };

        const label = row.createEl('label', { text: node });
        label.htmlFor = `rb-${node}`;
        label.style.cursor = 'pointer';
        label.style.fontWeight = 'bold';
        label.style.flex = '1';
    });

    // Botonera
    const buttonDiv = contentEl.createDiv();
    buttonDiv.style.display = 'flex';
    buttonDiv.style.justifyContent = 'flex-end';
    buttonDiv.style.gap = '10px';

    const cancelBtn = new ButtonComponent(buttonDiv)
        .setButtonText('Cancel')
        .onClick(() => this.close());

    submitButton = new ButtonComponent(buttonDiv)
        .setButtonText(`Merge into "${this.selectedTarget}"`)
        .setCta() // Azul brillante
        .onClick(async () => {
            // 1. ESTADO DE CARGA (UI FEEDBACK)
            submitButton.setButtonText('⏳ Merging...').setDisabled(true);
            cancelBtn.setDisabled(true);
            
            // 2. EJECUTAR ACCIÓN (ESPERAR)
            const sources = this.selectedNodes.filter(n => n !== this.selectedTarget);
            await this.onSubmit(this.selectedTarget, sources);
            
            // 3. CERRAR AL TERMINAR
            this.close();
        });
  }

  onClose() {
    this.contentEl.empty();
  }
}