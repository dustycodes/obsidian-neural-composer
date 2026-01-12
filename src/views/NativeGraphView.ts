import { ItemView, WorkspaceLeaf, Notice, setIcon, TextComponent, ButtonComponent, setTooltip } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
// Importaciones de Sigma/Graphology
import Graph from 'graphology';
import { parse } from 'graphology-graphml';
import Sigma from 'sigma';
import { circular } from 'graphology-layout';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker'; 
import ForceGraph3D from '3d-force-graph'; 

export const NATIVE_GRAPH_VIEW_TYPE = 'neural-native-graph';

interface GraphNode {
    id: string;
    type: string; // Categoría semántica
    desc: string;
    source_id: string;
    val: number; 
    degree?: number;
}

export class NativeGraphView extends ItemView {
  private plugin: any; 
  private graphDataPath: string;
  private workDir: string;
  
  // Motores
  private sigmaInstance: Sigma | null = null;
  private fa2Layout: any = null;
  private graph3D: any = null;
  
  // Estado
  private graph: Graph | null = null;
  private chunkToDocMap: Record<string, any> = {};
  private docToNameMap: Record<string, any> = {};

  // UI
  private detailsPanel: HTMLElement | null = null;
  private sidebarListEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private sortBtnEl: HTMLElement | null = null;
  private selectedNodes: Set<string> = new Set();
  private sortAscending: boolean = false;
  
  // Listas auxiliares
  private allNodes: GraphNode[] = [];
  private filteredNodes: GraphNode[] = [];

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
    
    const is3D = this.plugin.settings.graphViewMode === '3d';
    container.style.backgroundColor = is3D ? '#000005' : '#111111';

    await this.loadReferenceMaps();

    // IZQUIERDA
    const graphZone = container.createDiv();
    graphZone.style.flex = '1';
    graphZone.style.position = 'relative';
    graphZone.style.overflow = 'hidden';
    graphZone.style.borderRight = '1px solid var(--background-modifier-border)';
    
    // ID ESPECÍFICO
    const graphContainer = graphZone.createDiv();
    graphContainer.id = 'sigma-container';
    graphContainer.style.width = '100%';
    graphContainer.style.height = '100%';
    
    this.createGraphToolbar(graphZone, graphContainer);
    this.createDetailsPanel(graphZone);

    // DERECHA
    const sidebar = container.createDiv();
    sidebar.style.width = '320px';
    sidebar.style.display = 'flex';
    sidebar.style.flexDirection = 'column';
    sidebar.style.backgroundColor = 'var(--background-secondary)';
    sidebar.style.borderLeft = '1px solid var(--background-modifier-border)';

    this.buildSidebar(sidebar);

    setTimeout(() => this.render(graphContainer), 100);
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
      const chunks = sourceIds.split(new RegExp('<SEP>|,')).map(s => s.trim()).filter(Boolean);
      const fileNames = new Set<string>();
      chunks.forEach(chunkId => {
          const chunkData = this.chunkToDocMap[chunkId];
          if (chunkData && chunkData.full_doc_id) {
              const docData = this.docToNameMap[chunkData.full_doc_id];
              if (docData) fileNames.add(docData.file_name || docData.id || "Unknown");
          }
      });
      return Array.from(fileNames);
  }

  // --- RENDERIZADO PRINCIPAL ---
  async render(container: HTMLElement, label?: HTMLElement) {
    this.cleanup();
    container.empty();

    if (!fs.existsSync(this.graphDataPath)) {
        new Notice("❌ No Graph Data");
        if(label) label.innerText = "No Data";
        return;
    }

    try {
        const xmlData = fs.readFileSync(this.graphDataPath, 'utf-8');
        
        // 1. PARSEO (Graphology)
        this.graph = parse(Graph, xmlData);
        
        // 2. LIMPIEZA Y MAPEO DE ATRIBUTOS
        const nodesToDrop: string[] = [];
        
        // Usamos un bucle seguro
        this.graph?.forEachNode((node, attr) => {
            // Filtro de Chunks
            if (node.startsWith('chunk-') || node.startsWith('doc-') || (node.length > 50 && !node.includes(' '))) {
                nodesToDrop.push(node);
                return;
            }

            const degree = this.graph?.degree(node) || 1;
            const size = Math.max(3, Math.min(degree * 1.5, 20));
            
            // --- CORRECCIÓN CRÍTICA DE NOMBRE DE PROPIEDAD ---
            // LightRAG envía el tipo en 'd0' o 'entity_type'.
            // LO GUARDAMOS EN 'node_type' (Semántico)
            const semanticType = attr.d0 || attr.entity_type || "Concept";
            
            this.graph?.mergeNodeAttributes(node, {
                label: node, 
                size: size,
                color: '#00d4ff', 
                
                // PARA SIGMA (VISUAL): 'circle'
                type: 'circle', 
                
                // PARA NOSOTROS (DATOS): 'node_type'
                node_type: semanticType, 
                
                desc: attr.d1 || attr.description || "",
                source_id: attr.d2 || attr.source_id || "",
                val: degree + 1,
                x: Math.random() * 100,
                y: Math.random() * 100
            });
        });

        nodesToDrop.forEach(n => this.graph?.dropNode(n));
        this.updateSidebarList();

        const mode = this.plugin.settings.graphViewMode;
        if(label && this.graph) label.innerText = `${this.graph.order} Nodes | ${mode.toUpperCase()}`;

        if (mode === '3d') {
            this.render3D(container);
        } else {
            this.render2D(container);
        }

    } catch (e) {
        console.error("Graph Error:", e);
        new Notice("Error parsing graph.");
    }
  }

  // --- MOTOR 2D (SIGMA) ---
  render2D(container: HTMLElement) {
      if (!this.graph) return;

      // 1. Layout Inicial
      circular.assign(this.graph);

      // 2. Inicialización Diferida (Evita error Framebuffer 0)
      const initSigma = () => {
          if (container.clientWidth === 0 || container.clientHeight === 0) {
              requestAnimationFrame(initSigma);
              return;
          }
          
          // Chequeo de seguridad
          if (!this.graph) return;

          if (this.sigmaInstance) this.sigmaInstance.kill();

          this.sigmaInstance = new Sigma(this.graph, container, {
              minCameraRatio: 0.1,
              maxCameraRatio: 10,
              renderLabels: true,
              labelFont: "monospace",
              labelColor: { color: "#fff" },
              labelSize: 12,
              labelWeight: "bold",
              allowInvalidContainer: true,
          });

          const settings = forceAtlas2.inferSettings(this.graph);
          this.fa2Layout = new FA2Layout(this.graph, {
              settings: { ...settings, gravity: 1, slowDown: 10 }
          });
          
          this.fa2Layout.start();

          setTimeout(() => {
              if(this.fa2Layout && this.fa2Layout.isRunning()) this.fa2Layout.stop();
          }, 4000);

          this.sigmaInstance.on("clickNode", (event) => {
              const nodeId = event.node;
              const attrs = this.graph?.getNodeAttributes(nodeId);
              if (attrs) {
                  this.showNodeDetails({ 
                      id: nodeId, 
                      // Leemos la propiedad correcta
                      type: attrs.node_type, 
                      val: attrs.val, 
                      desc: attrs.desc, 
                      source_id: attrs.source_id 
                  });
              }
          });
      };

      requestAnimationFrame(initSigma);
  }

  // --- MOTOR 3D (FORCEGRAPH) ---
  render3D(container: HTMLElement) {
      if (!this.graph) return;
      
      const nodes: any[] = [];
      const links: any[] = [];
      
      this.graph.forEachNode((node, attr) => {
          // Mapeo para 3D: Usamos node_type como 'type' para el color
          nodes.push({ 
              id: node, 
              ...attr,
              type: attr.node_type // Sobreescribimos el 'circle' de Sigma con el tipo real
          });
      });
      this.graph.forEachEdge((edge, attr, source, target) => {
          links.push({ source, target });
      });

      const gData = { nodes, links };
      
      this.graph3D = (ForceGraph3D as any)()(container)
          .graphData(gData)
          .backgroundColor('#000005')
          .nodeAutoColorBy('type') // Colorea por categoría
          .nodeVal('size') 
          .nodeLabel('id') 
          .nodeOpacity(0.9)
          .linkWidth(0.6).linkOpacity(0.2).cooldownTicks(100)
          .onNodeClick((node: any) => {
              this.showNodeDetails(node);
              const dist = 40;
              const ratio = 1 + dist/Math.hypot(node.x, node.y, node.z);
              this.graph3D.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 2000);
          });
      
      this.graph3D.width(container.clientWidth);
      this.graph3D.height(container.clientHeight);
  }

  cleanup() {
      if (this.sigmaInstance) {
          this.sigmaInstance.kill();
          this.sigmaInstance = null;
      }
      if (this.fa2Layout) {
          this.fa2Layout.stop();
          this.fa2Layout = null;
      }
      if (this.graph3D) {
          (this.graph3D as any)._destructor();
          this.graph3D = null;
      }
  }

  updateSidebarList() {
      if (!this.graph) return;
      this.allNodes = this.graph.mapNodes((node, attr) => ({
          id: node,
          type: attr.node_type, // Leemos la propiedad correcta
          desc: attr.desc,
          source_id: attr.source_id,
          val: attr.val
      }));
      
      this.sortAscending = false;
      this.allNodes.sort((a, b) => b.val - a.val);
      this.filteredNodes = this.allNodes;
      this.renderList();
  }

  // ... (Resto de métodos UI: createDetailsPanel, showNodeDetails, updateNode, createGraphToolbar, buildSidebar, renderList...)
  // COPIA AQUÍ LOS MÉTODOS DE UI QUE YA TENÍAS. 
  // Solo ten cuidado con searchNode, asegúrate de que use 'node_type' si accede a atributos.

  searchNode(query: string) {
      if(!query) return;
      const lower = query.toLowerCase();
      
      if (this.plugin.settings.graphViewMode === '3d' && this.graph3D) {
           // ... Lógica 3D igual ...
      } 
      else if (this.sigmaInstance && this.graph) {
          // Sigma usa graphology para buscar
          const target = this.graph.nodes().find(n => n.toLowerCase().includes(lower));
          if (target) {
              const attrs = this.graph.getNodeAttributes(target);
              this.showNodeDetails({ id: target, ...attrs, type: attrs.node_type }); // Pasamos el tipo correcto
              
              const camera = this.sigmaInstance.getCamera();
              camera.animate({ x: attrs.x, y: attrs.y, ratio: 0.05 }, { duration: 1000 });
              new Notice(`Found: ${target}`);
          } else { new Notice("Node not found"); }
      }
  }
  
  // INCLUYE AQUÍ LOS MÉTODOS DE UI:
  // createDetailsPanel
  // showNodeDetails
  // updateNode
  // createGraphToolbar
  // buildSidebar
  // toggleSort
  // filterOrphans
  // filterList
  // renderList
  // mergeSelectedNodes
  // deleteSelectedNodes
  
  createDetailsPanel(container: HTMLElement) {
      this.detailsPanel = container.createDiv();
      this.detailsPanel.style.cssText = `position: absolute; top: 60px; right: 20px; width: 320px; max-height: 80%; background: rgba(20, 20, 25, 0.95); border: 1px solid #444; border-radius: 8px; padding: 0; z-index: 20; color: #eee; overflow-y: auto; display: none; box-shadow: 0 10px 40px rgba(0,0,0,0.8); backdrop-filter: blur(10px); font-family: monospace; font-size: 13px;`;
  }

  showNodeDetails(node: any) {
    if (!this.detailsPanel) return;
    const sources = this.getFilenames(node.source_id);
    const sourceHtml = sources.length > 0 ? sources.map(s => `<li style="margin-bottom:4px; color:#66fcf1;">📄 ${s}</li>`).join('') : '<li style="color:#666;">No explicit source</li>';

    this.detailsPanel.innerHTML = `
        <div style="background:var(--interactive-accent); padding:10px 15px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:white; font-size:0.9em;">${node.type?.toUpperCase()}</span>
            <button style="background:none; border:none; color:white; cursor:pointer;" id="close-panel-btn">✕</button>
        </div>
        <div style="padding:15px;">
            <h3 style="margin:0 0 10px 0; color:#fff; word-break:break-word;">${node.id}</h3>
            <div style="margin-bottom:15px; color:#aaa; font-size:0.9em;">Degree: <b style="color:#fff">${node.val}</b></div>
            <div style="font-size:0.9em; line-height:1.5; color:#ccc; background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; margin-bottom:15px; max-height:150px; overflow-y:auto;">${node.desc || "No description."}</div>
            <div style="border-top:1px solid #333; padding-top:15px;">
                <h4 style="margin:0 0 10px 0; color:#666; font-size:0.75em; text-transform:uppercase;">Context Sources</h4>
                <ul style="list-style:none; padding-left:0; margin:0;">${sourceHtml}</ul>
            </div>
        </div>
    `;
    this.detailsPanel.querySelector('#close-panel-btn')?.addEventListener('click', () => { if (this.detailsPanel) this.detailsPanel.style.display = 'none'; });
    this.detailsPanel.style.display = 'block';
  }

  async updateNode(oldName: string, data: { entity_name: string, entity_type: string, description: string }) {
      new Notice(`Updating node "${oldName}"...`);
      try {
          const response = await fetch("http://localhost:9621/graph/entity/edit", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "entity_name": oldName, "updated_data": data, "allow_rename": true, "allow_merge": true })
          });
          if (response.ok) { 
              new Notice("✅ Node updated!"); 
              setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1500); 
          } else { new Notice(`Error: ${await response.text()}`); }
      } catch (e) { console.error(e); new Notice("API connection error"); }
  }

  createGraphToolbar(container: HTMLElement, graphContainer: HTMLElement) {
      const tb = container.createDiv();
      tb.style.cssText = "position:absolute; top:15px; left:15px; z-index:10; display:flex; gap:8px; align-items:center;";
      const searchInput = tb.createEl('input');
      searchInput.type = 'text'; searchInput.placeholder = '🚀 Search...';
      searchInput.style.cssText = `background: rgba(0, 0, 0, 0.6); border: 1px solid var(--text-accent); color: #fff; padding: 6px 10px; border-radius: 6px; outline: none; width: 200px; backdrop-filter: blur(4px); font-family: monospace;`;
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.searchNode(searchInput.value); });

      const btnReload = tb.createEl('button');
      setIcon(btnReload, 'refresh-cw');
      setTooltip(btnReload, 'Reload Graph');
      btnReload.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReload.onclick = () => this.render(graphContainer);
      
      const btnReset = tb.createEl('button');
      setIcon(btnReset, 'maximize');
      setTooltip(btnReset, 'Reset Camera');
      btnReset.style.cssText = "background: rgba(0,0,0,0.6); border: 1px solid #444; color: #ccc; padding: 6px; border-radius: 6px; cursor: pointer;";
      btnReset.onclick = () => { 
          if (this.graph3D) this.graph3D.zoomToFit(1000, 50); 
          if (this.sigmaInstance) this.sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1.0 }, { duration: 500 });
      };
  }

  buildSidebar(container: HTMLElement) {
      const header = container.createDiv(); header.style.padding = '10px'; header.style.borderBottom = '1px solid var(--background-modifier-border)';
      header.createEl('h4', { text: 'Node Manager' }).style.margin = '0 0 10px 0';
      const searchInput = new TextComponent(header); searchInput.setPlaceholder('Filter list...'); searchInput.inputEl.style.width = '100%';
      searchInput.onChange((val) => this.filterList(val)); this.searchInputEl = searchInput.inputEl;
      const actionButtons = header.createDiv(); actionButtons.style.display = 'flex'; actionButtons.style.gap = '5px'; actionButtons.style.marginTop = '10px';
      new ButtonComponent(actionButtons).setButtonText('Merge').setCta().onClick(() => this.mergeSelectedNodes());
      new ButtonComponent(actionButtons).setButtonText('Delete').setWarning().onClick(() => this.deleteSelectedNodes());
      const filterBar = header.createDiv(); filterBar.style.marginTop = '10px'; filterBar.style.display = 'flex'; filterBar.style.justifyContent = 'space-between'; filterBar.style.fontSize = '0.8em';
      this.sortBtnEl = filterBar.createEl('span', { text: 'Sort: Degree ⬇' });
      this.sortBtnEl.style.cursor = 'pointer'; this.sortBtnEl.style.color = 'var(--text-accent)';
      this.sortBtnEl.onclick = () => this.toggleSort();
      const orphansBtn = filterBar.createEl('span', { text: 'Show Orphans' });
      orphansBtn.style.cursor = 'pointer'; orphansBtn.style.color = 'var(--text-muted)'; orphansBtn.style.textDecoration = "underline";
      setTooltip(orphansBtn, 'Show disconnected nodes');
      orphansBtn.onclick = () => this.filterOrphans();
      this.sidebarListEl = container.createDiv(); this.sidebarListEl.style.flex = '1'; this.sidebarListEl.style.overflowY = 'auto';
  }

  toggleSort() { this.sortAscending = !this.sortAscending; if (this.sortBtnEl) this.sortBtnEl.textContent = `Sort: Degree ${this.sortAscending ? '⬆' : '⬇'}`; this.filteredNodes.sort((a, b) => this.sortAscending ? a.val - b.val : b.val - a.val); this.renderList(); }
  filterOrphans() { if (this.searchInputEl) this.searchInputEl.value = ''; this.filteredNodes = this.allNodes.filter(n => n.val === 1); this.renderList(); }
  filterList(query: string) { if (!query) { this.filteredNodes = this.allNodes; } else { const q = query.toLowerCase(); this.filteredNodes = this.allNodes.filter(n => n.id.toLowerCase().includes(q)); } this.renderList(); }
  
  renderList() {
      if (!this.sidebarListEl) return;
      this.sidebarListEl.empty();
      const visibleNodes = this.filteredNodes.slice(0, 50);
      visibleNodes.forEach(node => {
          const row = this.sidebarListEl!.createDiv();
          row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.padding = '6px'; row.style.borderBottom = '1px solid var(--background-modifier-border)'; row.style.fontSize = '0.85em';
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = this.selectedNodes.has(node.id);
          cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) this.selectedNodes.add(node.id); else this.selectedNodes.delete(node.id); };
          const info = row.createDiv(); info.style.flex = '1'; info.style.marginLeft = '8px'; info.style.cursor = 'pointer';
          info.innerHTML = `<div style="font-weight:bold;">${node.id}</div><div style="color:var(--text-muted); font-size:0.9em;">${node.type} (${node.val > 0 ? node.val - 1 : 0})</div>`;
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
          if (response.ok) { new Notice("Merged!"); this.selectedNodes.clear(); setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000); }
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
          setTimeout(() => this.render(this.contentEl.querySelector('#sigma-container') as HTMLElement), 1000);
      } catch (e) { console.error(e); }
  }
}