import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import cytoscape from 'cytoscape';
import ForceGraph3D from '3d-force-graph';

export const NATIVE_GRAPH_VIEW_TYPE = 'neural-native-graph';

interface GraphNode {
    id: string;
    type: string;
    desc: string;
    source_id: string;
    val: number; 
    degree?: number;
}

export class NativeGraphView extends ItemView {
  private plugin: any; 
  private graphDataPath: string;
  private workDir: string;
  
  private cy: any = null;
  private graph3D: any = null;
  
  private allNodes: GraphNode[] = [];
  private filteredNodes: GraphNode[] = [];
  private selectedNodes: Set<string> = new Set();
  private sortAscending: boolean = false;

  private chunkToDocMap: Record<string, any> = {};
  private docToNameMap: Record<string, any> = {};

  private sidebarListEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private detailsPanel: HTMLElement | null = null;
  private sortBtnEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.workDir = plugin.settings.lightRagWorkDir;
    this.graphDataPath = path.join(this.workDir, 'graph_chunk_entity_relation.graphml');
  }

  getViewType() { return NATIVE_GRAPH_VIEW_TYPE; }
  getDisplayText() { return 'Neural Manager'; }
  getIcon() { return 'brain-circuit'; }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.style.display = 'flex';
    container.style.height = '100%';
    container.style.width = '100%';
    container.style.backgroundColor = 'var(--background-primary)';

    await this.loadReferenceMaps();

    // IZQUIERDA
    const graphZone = container.createDiv();
    graphZone.style.flex = '1';
    graphZone.style.position = 'relative';
    graphZone.style.overflow = 'hidden';
    graphZone.style.borderRight = '1px solid var(--background-modifier-border)';
    
    const graphCanvas = graphZone.createDiv();
    graphCanvas.id = 'graph-container';
    graphCanvas.style.width = '100%';
    graphCanvas.style.height = '100%';
    
    this.createGraphToolbar(graphZone, graphCanvas);
    this.createDetailsPanel(graphZone);

    // DERECHA
    const sidebar = container.createDiv();
    sidebar.style.width = '320px';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.backgroundColor = 'var(--background-secondary)';
    sidebar.style.borderLeft = '1px solid var(--background-modifier-border)';

    this.buildSidebar(sidebar);

    setTimeout(() => this.render(graphCanvas), 100);
  }

  async loadReferenceMaps() {
      try {
          const chunksPath = path.join(this.workDir, 'kv_store_text_chunks.json');
          const docsPath = path.join(this.workDir, 'kv_store_doc_status.json');
          if (fs.existsSync(chunksPath)) this.chunkToDocMap = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
          if (fs.existsSync(docsPath)) this.docToNameMap = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
      } catch (e) { console.error("Error loading maps", e); }
  }

  getFilenames(sourceIds: string): string[] {
      if (!sourceIds) return [];
      // LightRAG usa <SEP> para separar chunks
      const chunks = sourceIds.split(new RegExp('<SEP>|,')).map(s => s.trim()).filter(Boolean);
      const fileNames = new Set<string>();
      
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          if (chunkData && chunkData.full_doc_id) {
              const docData = this.docToNameMap[chunkData.full_doc_id];
              if (docData) {
                  // Intentamos obtener el nombre más legible posible
                  // A veces content_summary es muy largo, preferimos id o file_name si existe en el JSON
                  // LightRAG a veces no guarda 'file_name' explícito en doc_status, pero el ID suele ser útil.
                  // Si tenemos 'file_path' en nuestros datos personalizados, úsalo.
                  fileNames.add(docData.file_name || docData.file_path || docData.id || "Unknown");
              }
          }
      });
      return Array.from(fileNames);
  }

  // --- UI COMPONENTS ---

  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv();
      this.detailsPanel.style.cssText = `
        position: absolute; top: 60px; right: 20px; width: 340px; max-height: 85%;
        background: rgba(20, 20, 25, 0.95); border: 1px solid #444;
        border-radius: 8px; padding: 0; z-index: 20;
        color: #eee; overflow-y: auto; display: none;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8); backdrop-filter: blur(10px);
        font-family: var(--font-ui); font-size: 13px;
      `;
  }

  // --- LÓGICA DE DETALLES Y EDICIÓN COMPLETA ---
  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    
    // Depuración: ver qué llega
    console.log("Showing Node:", node);
    
    const sources = this.getFilenames(node.source_id);
    const sourceHtml = sources.length > 0 
        ? sources.map(s => `<li style="margin-bottom:4px; color:#66fcf1;">📄 ${s}</li>`).join('') 
        : '<li style="color:#666;">No explicit source found</li>';

    this.detailsPanel.innerHTML = `
        <div style="background:var(--interactive-accent); padding:10px 15px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:white; font-size:0.9em;">NODE DETAILS</span>
            <div style="display:flex; gap:10px;">
                <button id="toggle-edit-btn" style="background:rgba(0,0,0,0.2); border:none; color:white; cursor:pointer; padding:2px 8px; border-radius:4px;" title="Edit Node">✏️ Edit</button>
                <button id="close-panel-btn" style="background:none; border:none; color:white; cursor:pointer; font-weight:bold;">✕</button>
            </div>
        </div>

        <!-- MODO LECTURA -->
        <div id="view-mode" style="padding:15px;">
            <div style="margin-bottom:10px;">
                <span style="background:#444; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75em; text-transform:uppercase;">${node.type}</span>
                <span style="color:#aaa; font-size:0.8em; margin-left:10px;">Links: ${node.val}</span>
            </div>
            <h2 style="margin:0 0 15px 0; color:#fff; word-break:break-word; line-height:1.2;">${node.id}</h2>
            
            <div style="font-size:0.95em; line-height:1.6; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:20px; white-space: pre-wrap;">
                ${node.desc || "No description."}
            </div>

            <div style="border-top:1px solid #333; padding-top:15px;">
                <h4 style="margin:0 0 10px 0; color:#666; font-size:0.75em; letter-spacing:1px; text-transform:uppercase;">Context Sources</h4>
                <ul style="list-style:none; padding-left:0; margin:0;">${sourceHtml}</ul>
            </div>
        </div>

        <!-- MODO EDICIÓN -->
        <div id="edit-mode" style="padding:15px; display:none;">
            <label style="color:#aaa; font-size:0.8em; display:block; margin-bottom:4px;">Node Name (ID)</label>
            <input type="text" id="edit-name" value="${node.id}" style="width:100%; margin-bottom:15px; background:#333; color:white; border:1px solid #555; padding:6px; border-radius:4px;">
            
            <label style="color:#aaa; font-size:0.8em; display:block; margin-bottom:4px;">Entity Type</label>
            <input type="text" id="edit-type" value="${node.type}" style="width:100%; margin-bottom:15px; background:#333; color:white; border:1px solid #555; padding:6px; border-radius:4px;">
            
            <label style="color:#aaa; font-size:0.8em; display:block; margin-bottom:4px;">Description</label>
            <textarea id="edit-desc" rows="6" style="width:100%; margin-bottom:15px; background:#333; color:white; border:1px solid #555; padding:6px; border-radius:4px; font-family:inherit;">${node.desc || ""}</textarea>
            
            <div style="display:flex; gap:10px; justify-content:flex-end; border-top:1px solid #333; padding-top:15px;">
                <button id="cancel-edit-btn" style="padding:6px 12px; cursor:pointer;">Cancel</button>
                <button id="save-edit-btn" style="background:var(--interactive-accent); color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">💾 Save Changes</button>
            </div>
        </div>
    `;
    
    // EVENTOS
    const viewMode = this.detailsPanel.querySelector('#view-mode') as HTMLElement;
    const editMode = this.detailsPanel.querySelector('#edit-mode') as HTMLElement;
    const nameInput = this.detailsPanel.querySelector('#edit-name') as HTMLInputElement;
    const typeInput = this.detailsPanel.querySelector('#edit-type') as HTMLInputElement;
    const descInput = this.detailsPanel.querySelector('#edit-desc') as HTMLTextAreaElement;

    this.detailsPanel.querySelector('#toggle-edit-btn')?.addEventListener('click', () => {
        viewMode.style.display = 'none';
        editMode.style.display = 'block';
    });

    this.detailsPanel.querySelector('#cancel-edit-btn')?.addEventListener('click', () => {
        editMode.style.display = 'none';
        viewMode.style.display = 'block';
    });

    this.detailsPanel.querySelector('#close-panel-btn')?.addEventListener('click', () => {
        if (this.detailsPanel) this.detailsPanel.style.display = 'none';
    });

    this.detailsPanel.querySelector('#save-edit-btn')?.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        const newType = typeInput.value.trim();
        const newDesc = descInput.value.trim();

        if (!newName) { new Notice("Name cannot be empty"); return; }

        await this.updateNode(node.id, {
            entity_name: newName,
            entity_type: newType,
            description: newDesc
        });
        
        if (this.detailsPanel) this.detailsPanel.style.display = 'none';
    });

    this.detailsPanel.style.display = 'block';
  }

  async updateNode(oldName: string, data: { entity_name: string, entity_type: string, description: string }) {
      new Notice(`Updating node "${oldName}"...`);
      try {
          const response = await fetch("http://localhost:9621/graph/entity/edit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  "entity_name": oldName,
                  "updated_data": {
                      "entity_name": data.entity_name,
                      "entity_type": data.entity_type,
                      "description": data.description
                  },
                  "allow_rename": true,
                  "allow_merge": true 
              })
          });

          if (response.ok) {
              new Notice("✅ Node updated!");
              setTimeout(() => this.render(this.contentEl.querySelector('#graph-container') as HTMLElement), 1500);
          } else {
              const err = await response.text();
              new Notice(`Error updating: ${err}`);
          }
      } catch (e) {
          console.error(e);
          new Notice("API connection error");
      }
  }

  createGraphToolbar(container: HTMLElement, graphCanvas: HTMLElement) {
      const tb = container.createDiv();
      tb.style.cssText = "position:absolute; top:15px; left:15px; z-index:10; display:flex; gap:8px; align-items:center;";
      
      const searchInput = tb.createEl('input');
      searchInput.type = 'text';
      searchInput.placeholder = '🚀 Search & Fly...';
      searchInput.style.cssText = `
          background: rgba(0, 0, 0, 0.6); border: 1px solid var(--text-accent); color: #fff;
          padding: 6px 10px; border-radius: 6px; outline: none; width: 200px;
          backdrop-filter: blur(4px); transition: all 0.2s ease; font-family: monospace;
      `;
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.searchNode(searchInput.value); });

      const btnReload = tb.createEl('button');
      setIcon(btnReload, 'refresh-cw');
      setTooltip(btnReload, 'Reload Graph');
      btnReload.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReload.onclick = () => this.render(graphCanvas);
      
      const btnReset = tb.createEl('button');
      setIcon(btnReset, 'maximize');
      setTooltip(btnReset, 'Reset Camera');
      btnReset.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReset.onclick = () => { if (this.graph3D) this.graph3D.zoomToFit(1000, 50); };
  }

  buildSidebar(container: HTMLElement) {
      const header = container.createDiv();
      header.style.padding = '10px';
      header.style.borderBottom = '1px solid var(--background-modifier-border)';
      
      header.createEl('h4', { text: 'Node Manager' }).style.margin = '0 0 10px 0';

      const searchInput = new TextComponent(header);
      searchInput.setPlaceholder('Filter list...');
      searchInput.inputEl.style.width = '100%';
      searchInput.onChange((val) => this.filterList(val));
      this.searchInputEl = searchInput.inputEl;

      const actionButtons = header.createDiv();
      actionButtons.style.display = 'flex';
      actionButtons.style.gap = '5px';
      actionButtons.style.marginTop = '10px';

      new ButtonComponent(actionButtons).setButtonText('Merge Selected').setCta().onClick(() => this.mergeSelectedNodes());
      new ButtonComponent(actionButtons).setButtonText('Delete Selected').setWarning().onClick(() => this.deleteSelectedNodes());

      const filterBar = header.createDiv();
      filterBar.style.marginTop = '10px';
      filterBar.style.display = 'flex';
      filterBar.style.justifyContent = 'space-between';
      filterBar.style.fontSize = '0.8em';
      
      this.sortBtnEl = filterBar.createEl('span', { text: 'Sort: Degree ⬇' });
      this.sortBtnEl.style.cursor = 'pointer'; this.sortBtnEl.style.color = 'var(--text-accent)';
      
      this.sortBtnEl.onclick = () => {
          this.sortAscending = !this.sortAscending;
          if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`;
          this.filteredNodes.sort((a, b) => this.sortAscending ? a.val - b.val : b.val - a.val);
          this.renderList();
      };

      const orphansBtn = filterBar.createEl('span', { text: 'Show Orphans' });
      orphansBtn.style.cursor = 'pointer'; 
      orphansBtn.style.color = 'var(--text-muted)';
      orphansBtn.style.textDecoration = "underline";
      setTooltip(orphansBtn, 'Show disconnected nodes');
      orphansBtn.onclick = () => this.filterOrphans();

      this.sidebarListEl = container.createDiv();
      this.sidebarListEl.style.flex = '1';
      this.sidebarListEl.style.overflowY = 'auto';
  }

  toggleSort() {
      this.sortAscending = !this.sortAscending;
      if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`;
      this.filteredNodes.sort((a, b) => this.sortAscending ? a.val - b.val : b.val - a.val);
      this.renderList();
  }

  filterOrphans() {
      if (this.searchInputEl) this.searchInputEl.value = '';
      this.filteredNodes = this.allNodes.filter(n => n.val === 1); 
      this.renderList();
      new Notice(`Found ${this.filteredNodes.length} orphan nodes.`);
  }

  filterList(query: string) {
      if (!query) { this.filteredNodes = this.allNodes; } 
      else { const q = query.toLowerCase(); this.filteredNodes = this.allNodes.filter(n => n.id.toLowerCase().includes(q)); }
      this.renderList();
  }

  renderList() {
      if (!this.sidebarListEl) return;
      this.sidebarListEl.empty();
      const visibleNodes = this.filteredNodes.slice(0, 50);
      visibleNodes.forEach(node => {
          const row = this.sidebarListEl!.createDiv();
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.padding = '6px';
          row.style.borderBottom = '1px solid var(--background-modifier-border)';
          row.style.fontSize = '0.85em';
          
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = this.selectedNodes.has(node.id);
          cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) this.selectedNodes.add(node.id); else this.selectedNodes.delete(node.id); };
          
          const info = row.createDiv();
          info.style.flex = '1';
          info.style.marginLeft = '8px';
          info.style.cursor = 'pointer';
          const degree = node.val > 0 ? node.val - 1 : 0;
          info.innerHTML = `<div style="font-weight:bold;">${node.id}</div><div style="color:var(--text-muted); font-size:0.9em;">${node.type} (${degree})</div>`;
          info.onclick = () => this.searchNode(node.id); 
      });
      if (this.filteredNodes.length > 100) {
          const more = this.sidebarListEl.createDiv();
          more.style.padding = '10px';
          more.style.textAlign = 'center';
          more.style.color = 'var(--text-muted)';
          more.innerText = `...and ${this.filteredNodes.length - 100} more.`;
      }
  }

  async mergeSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length < 2) { new Notice("Select 2+ nodes"); return; }
      if(!confirm(`Merge ${targets.length} nodes into "${targets[0]}"?`)) return;
      try {
          const response = await fetch("http://localhost:9621/graph/entities/merge", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "entity_to_change_into": targets[0], "entities_to_change": targets.slice(1) })
          });
          if (response.ok) { new Notice("Merged!"); this.selectedNodes.clear(); setTimeout(() => this.render(this.contentEl.querySelector('#graph-container') as HTMLElement), 1000); }
      } catch (e) { console.error(e); }
  }

  async deleteSelectedNodes() {
      const targets = Array.from(this.selectedNodes);
      if (targets.length === 0) return;
      if(!confirm(`Delete ${targets.length} nodes?`)) return;
      try {
          for (const entity of targets) {
              await fetch("http://localhost:9621/documents/delete_entity", {
                  method: "DELETE", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ "entity_name": entity })
              });
          }
          new Notice("Deleted!"); this.selectedNodes.clear();
          setTimeout(() => this.render(this.contentEl.querySelector('#graph-container') as HTMLElement), 1000);
      } catch (e) { console.error(e); }
  }

  async render(container: HTMLElement, label?: HTMLElement) {
    if (this.graph3D) { (this.graph3D as any)._destructor(); this.graph3D = null; }
    container.empty();

    if (!fs.existsSync(this.graphDataPath)) {
        if(label) label.innerText = "❌ No Data";
        return;
    }

    try {
        const xmlData = fs.readFileSync(this.graphDataPath, 'utf-8');
        
        // CORRECCIÓN: PARSER SIN PREFIJOS Y MAPEADOR INTELIGENTE
        const parser = new XMLParser({ 
            ignoreAttributes: false, 
            attributeNamePrefix: "", 
            textNodeName: "value" 
        });
        const jsonObj = parser.parse(xmlData);
        
        // 1. Mapeo de Claves (d0, d1 -> description, etc)
        const keys = Array.isArray(jsonObj.graphml?.key) ? jsonObj.graphml.key : [jsonObj.graphml.key];
        const keyMap: Record<string, string> = {};
        keys.forEach((k: any) => { 
            // LightRAG usa 'id' (d0) y 'attr.name' (entity_type)
            if (k['attr.name']) keyMap[k['id']] = k['attr.name'];
        });

        const rawNodes = Array.isArray(jsonObj.graphml?.graph?.node) ? jsonObj.graphml.graph.node : [jsonObj.graphml.graph.node];
        const rawEdges = Array.isArray(jsonObj.graphml?.graph?.edge) ? jsonObj.graphml.graph.edge : [jsonObj.graphml.graph.edge];

        const nodeDegrees = new Map<string, number>();
        rawEdges.forEach((e: any) => {
            const src = e.source; const tgt = e.target;
            nodeDegrees.set(src, (nodeDegrees.get(src) || 0) + 1);
            nodeDegrees.set(tgt, (nodeDegrees.get(tgt) || 0) + 1);
        });

        this.allNodes = rawNodes.map((n: any) => {
            let type = "Unknown";
            let desc = "";
            let source_id = "";
            
            const dataArr = Array.isArray(n.data) ? n.data : (n.data ? [n.data] : []);
            
            // BUCLE DE EXTRACCIÓN CORRECTA
            dataArr.forEach((d: any) => { 
                const mappedName = keyMap[d.key];
                
                if (mappedName === "entity_type" || d.key === "d0") type = d.value;
                if (mappedName === "description" || d.key === "d1") desc = d.value;
                if (mappedName === "source_id" || d.key === "d2") source_id = d.value;
            });

            return {
                id: n.id,
                type: type,
                desc: desc,
                source_id: source_id,
                val: (nodeDegrees.get(n.id) || 0) + 1
            };
        });
        
        this.allNodes.sort((a, b) => b.val - a.val);
        this.filteredNodes = this.allNodes;
        this.renderList();
        this.render3D(container, this.allNodes, rawEdges);

    } catch (e) { console.error(e); }
  }

  render3D(container: HTMLElement, nodes: any[], edges: any[]) {
      const gData = {
          nodes: nodes,
          links: edges.map((e: any) => ({ source: e.source, target: e.target }))
      };
      
      const mode = this.plugin.settings.graphViewMode;
      const bg = mode === '3d' ? '#000005' : '#ffffff';

      this.graph3D = (ForceGraph3D as any)()(container)
          .graphData(gData)
          .backgroundColor(bg)
          .nodeAutoColorBy('type')
          .nodeVal('val') 
          .nodeRelSize(4)
          .nodeLabel((node: any) => `${node.id}`) 
          .nodeOpacity(0.9)
          .nodeResolution(16)
          .linkWidth(0.6)
          .linkOpacity(0.2)
          .cooldownTicks(100)
          .onNodeClick((node: any) => {
              this.showNodeDetails(node);
              const dist = 40;
              const ratio = 1 + dist/Math.hypot(node.x, node.y, node.z);
              this.graph3D.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 2000);
          });
      
      this.graph3D.width(container.clientWidth);
      this.graph3D.height(container.clientHeight);
  }

  searchNode(query: string) {
      if(!query || !this.graph3D) return;
      const lower = query.toLowerCase();
      const { nodes } = this.graph3D.graphData();
      const target = nodes.find((n: any) => n.id.toLowerCase().includes(lower));
      if (target) {
          this.showNodeDetails(target);
          const dist = 40;
          const ratio = 1 + dist/Math.hypot(target.x, target.y, target.z);
          this.graph3D.cameraPosition({ x: target.x * ratio, y: target.y * ratio, z: target.z * ratio }, target, 2000);
          new Notice(`Found: ${target.id}`);
      } else { new Notice("Node not found"); }
  }
}