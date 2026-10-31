/**
 * ============================================================================
 * MÓDULO: OBSERVADOR DO COFRE DO OBSIDIAN EM TEMPO REAL (VaultWatcher)
 * Arquivo: js/memory/vault_watcher.js
 * ============================================================================
 * 
 * Responsabilidades:
 * 1. Monitorar o diretório BitBop-Cerebro/ com fs.watch recursivo.
 * 2. Aplicar debounce de 600ms por arquivo para aguardar o salvamento completo do Obsidian.
 * 3. Ignorar gravações internas originadas pelo próprio BitBop (< 1800ms).
 * 4. Ao detectar edição manual do Álvaro no Obsidian:
 *    - Reindexa o arquivo no MemoryIndex em < 10ms.
 *    - Se for de 00_Nucleo/, invalida o cache de núcleo para atualização instantânea.
 */

(function (global) {
  'use strict';

  const nodeFs = typeof require !== 'undefined' ? (() => { try { return require('fs'); } catch { return null; } })() : null;
  const nodePath = typeof require !== 'undefined' ? (() => { try { return require('path'); } catch { return null; } })() : null;

  let watcherInstance = null;
  const debounceTimers = new Map(); // relPath -> TimeoutId
  let isWatching = false;

  function getVaultDir() {
    if (global.MemoryStore && typeof global.MemoryStore.getVaultPath === 'function') {
      return global.MemoryStore.getVaultPath();
    }
    const base = nodePath && typeof __dirname !== 'undefined' ? nodePath.resolve(__dirname, '..', '..') : '.';
    return nodePath ? nodePath.join(base, 'BitBop-Cerebro') : 'BitBop-Cerebro';
  }

  /**
   * Processa a alteração de um arquivo no Vault após o debounce.
   */
  function handleFileChange(relPath) {
    if (!global.MemoryStore || !global.MemoryIndex || !nodeFs || !nodePath) return;

    // Normaliza separadores para barra normal
    const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');

    // Ignora pastas internas do BitBop e arquivos temporários
    if (cleanRel.startsWith('.bitbop') || cleanRel.startsWith('.git') || cleanRel.includes('.tmp_') || cleanRel.startsWith('99_Arquivo')) {
      return;
    }

    if (!cleanRel.endsWith('.md')) return;

    // Se a alteração foi gerada pelo próprio robô, ignora
    if (global.MemoryStore.isInternalWrite(cleanRel)) {
      return;
    }

    const vaultDir = getVaultDir();
    const fullPath = nodePath.join(vaultDir, cleanRel);

    // Se o arquivo foi excluído
    if (!nodeFs.existsSync(fullPath)) {
      global.MemoryIndex.removeFileFromIndex(cleanRel);
      console.log(`[VaultWatcher] Nota removida do índice (excluída no Obsidian): "${cleanRel}"`);
      if (global.BrainCatalog && typeof global.BrainCatalog.onVaultFileChanged === 'function') {
        global.BrainCatalog.onVaultFileChanged(cleanRel);
      }
      return;
    }

    // Marca que a nota foi editada manualmente pelo usuário no Obsidian
    if (global.MemoryStore && typeof global.MemoryStore.markUserEdited === 'function') {
      global.MemoryStore.markUserEdited(cleanRel);
    }

    // Lê a nota para sincronizar resumo_curto derivado do corpo e remover autorreferências
    try {
      const readRes = global.MemoryStore.readNote(cleanRel);
      if (readRes && readRes.ok) {
        const fm = readRes.frontmatter || {};
        const rawBody = readRes.body || '';
        const cleanBody = rawBody.trim();
        const cleanBodySummary = cleanBody ? cleanBody.replace(/\r?\n+/g, ' ').slice(0, 180) : '';
        let needsSync = false;
        const updatedFm = { ...fm };

        // 1. Remove qualquer autorreferência espúria em superada_por
        if (updatedFm.superada_por) {
          const spClean = String(updatedFm.superada_por).replace(/[\[\]]/g, '').trim();
          const baseName = nodePath.basename(cleanRel, '.md');
          if (spClean === cleanRel || spClean === baseName || spClean.endsWith('/' + baseName)) {
            updatedFm.superada_por = null;
            needsSync = true;
          }
        }

        // 2. Se o usuário alterou o corpo no Obsidian, sincroniza o resumo_curto no frontmatter
        if (cleanBodySummary && updatedFm.resumo_curto !== cleanBodySummary) {
          updatedFm.resumo_curto = cleanBodySummary;
          updatedFm.confianca = 1.0;
          updatedFm.ultimo_acesso = new Date().toISOString();
          needsSync = true;
        }

        if (needsSync) {
          global.MemoryStore.writeNote(cleanRel, updatedFm, rawBody, { forceOverrideLock: true });
        }
      }
    } catch (syncErr) {
      console.warn('[VaultWatcher] Erro ao sincronizar frontmatter:', syncErr);
    }

    // Reindexa a nota em RAM com os novos dados
    const meta = global.MemoryIndex.indexSingleFile(cleanRel);
    if (meta) {
      // Se for alteração nos arquivos de perfil/identidade do 00_Nucleo/, invalida o cache imediatamente
      if (cleanRel.startsWith('00_Nucleo')) {
        global.MemoryStore.invalidateCoreCache();
        console.log(`[VaultWatcher] Núcleo atualizado pelo Obsidian: "${cleanRel}"`);
      } else {
        console.log(`[VaultWatcher] Nota sincronizada do Obsidian: "${cleanRel}" (${meta.titulo})`);
      }

      // Notifica componentes da interface se necessário
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('bitbop-vault-updated', { detail: { path: cleanRel, meta } }));
      }
      if (global.BrainCatalog && typeof global.BrainCatalog.onVaultFileChanged === 'function') {
        global.BrainCatalog.onVaultFileChanged(cleanRel);
      }
    }
  }

  /**
   * Inicia o observador recursivo do diretório.
   */
  function startWatching() {
    if (!nodeFs || !nodePath || isWatching) return false;
    const vaultDir = getVaultDir();

    if (!nodeFs.existsSync(vaultDir)) {
      console.warn(`[VaultWatcher] Diretório do Vault não encontrado: ${vaultDir}`);
      return false;
    }

    try {
      watcherInstance = nodeFs.watch(vaultDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const rel = filename.toString();
        // Debounce de 600ms por arquivo
        if (debounceTimers.has(rel)) {
          clearTimeout(debounceTimers.get(rel));
        }

        const timer = setTimeout(() => {
          debounceTimers.delete(rel);
          handleFileChange(rel);
        }, 600);

        debounceTimers.set(rel, timer);
      });

      isWatching = true;
      console.log(`[VaultWatcher] Monitoramento em tempo real ativo em: "${vaultDir}"`);
      return true;
    } catch (err) {
      console.error('[VaultWatcher] Erro ao iniciar fs.watch:', err);
      return false;
    }
  }

  /**
   * Para o observador.
   */
  function stopWatching() {
    if (watcherInstance) {
      try { watcherInstance.close(); } catch {}
      watcherInstance = null;
    }
    for (const t of debounceTimers.values()) clearTimeout(t);
    debounceTimers.clear();
    isWatching = false;
  }

  const VaultWatcher = {
    startWatching,
    stopWatching,
    handleFileChange,
    isWatching: () => isWatching
  };

  // Inicia automaticamente o monitoramento se estiver no ambiente Node/Electron
  if (nodeFs && nodePath) {
    setTimeout(() => {
      startWatching();
    }, 500);
  }

  global.VaultWatcher = VaultWatcher;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = VaultWatcher;
  }

})(typeof window !== 'undefined' ? window : global);
