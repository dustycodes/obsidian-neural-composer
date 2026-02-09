import { App, Modal, ButtonComponent, TextAreaComponent, Notice } from 'obsidian';

export class CreateRelationModal extends Modal {
  private sources: string[];
  private onSubmit: (data: { source: string, targets: string[], description: string, keywords: string }) => Promise<void>;
  private onSuggestAI: (source: string, targets: string[]) => Promise<string>;
  
  private selectedSource: string;
  private description: string = "";
  private keywords: string = "manual connection";

  constructor(
    app: App, 
    nodes: string[], 
    onSubmit: (data: { source: string, targets: string[], description: string, keywords: string }) => Promise<void>,
    onSuggestAI: (source: string, targets: string[]) => Promise<string>
  ) {
    super(app);
    this.sources = nodes;
    this.selectedSource = nodes[0];
    this.onSubmit = onSubmit;
    this.onSuggestAI = onSuggestAI;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: 'Create new relationship' });

    // --- SELECCIÓN DEL NODO ORIGEN (HUB) ---
    // Fix: Sentence case "The Hub" -> "the hub"
    contentEl.createEl('label', { text: 'Select source node (the hub):', cls: 'nrlcmp-modal-label' });
    const sourceSelect = contentEl.createEl('select', { cls: 'dropdown' });
    // Fix: Use setCssProps instead of style.width
    sourceSelect.setCssProps({ width: "100%" });
    
    this.sources.forEach(node => {
        const opt = sourceSelect.createEl('option', { text: node, value: node });
        if (node === this.selectedSource) opt.selected = true;
    });
    sourceSelect.onchange = () => { this.selectedSource = sourceSelect.value; };

    // --- LISTA DE OBJETIVOS ---
    contentEl.createEl('label', { text: 'Target nodes:', cls: 'nrlcmp-modal-label' });
    const targetList = contentEl.createDiv({ cls: 'nrlcmp-modal-input-container' });
    // Fix: Use setCssProps
    targetList.setCssProps({ "font-size": "0.85em" });
    targetList.setText("All other selected nodes will be linked to the source.");

    // --- DESCRIPCIÓN ---
    contentEl.createEl('label', { text: 'Relationship description:', cls: 'nrlcmp-modal-label' });
    const descArea = new TextAreaComponent(contentEl)
        .setPlaceholder('Describe how these concepts are connected...')
        .onChange(val => this.description = val);
    // Fix: Use setCssProps
    descArea.inputEl.setCssProps({ width: "100%" });
    descArea.inputEl.rows = 4;

    // --- BOTÓN SUGERENCIA AI ---
    const aiBtnContainer = contentEl.createDiv();
    // Fix: Use setCssProps
    aiBtnContainer.setCssProps({ "margin-top": "10px" });
    
    const aiBtn = new ButtonComponent(aiBtnContainer)
        .setButtonText("Suggest with AI")
        // Fix: Handle floating promise with void wrapper
        .onClick(() => {
            void (async () => {
                aiBtn.setDisabled(true).setButtonText("Thinking...");
                const targets = this.sources.filter(n => n !== this.selectedSource);
                const suggestion = await this.onSuggestAI(this.selectedSource, targets);
                descArea.setValue(suggestion);
                this.description = suggestion;
                aiBtn.setDisabled(false).setButtonText("Suggest with AI");
            })();
        });

    // --- KEYWORDS ---
    contentEl.createEl('label', { text: 'Keywords (comma separated):', cls: 'nrlcmp-modal-label' });
    const kwInput = contentEl.createEl('input', { type: 'text', value: this.keywords });
    // Fix: Use setCssProps
    kwInput.setCssProps({ width: "100%" });
    kwInput.onchange = () => { this.keywords = kwInput.value; };

    // --- BOTONERA FINAL ---
    const buttonDiv = contentEl.createDiv({ cls: 'nrlcmp-edit-actions' });
    // Fix: Use setCssProps
    buttonDiv.setCssProps({ "margin-top": "20px" });

    new ButtonComponent(buttonDiv)
        .setButtonText('Cancel')
        .onClick(() => this.close());

    const saveBtn = new ButtonComponent(buttonDiv)
        .setButtonText('Create connection')
        .setCta()
        // Fix: Handle floating promise with void wrapper
        .onClick(() => {
            void (async () => {
                if (!this.description.trim()) {
                    new Notice("Please provide a description.");
                    return;
                }
                saveBtn.setDisabled(true).setButtonText("Connecting...");
                const targets = this.sources.filter(n => n !== this.selectedSource);
                await this.onSubmit({
                    source: this.selectedSource,
                    targets: targets,
                    description: this.description,
                    keywords: this.keywords
                });
                this.close();
            })();
        });
  }

  onClose() { this.contentEl.empty(); }
}