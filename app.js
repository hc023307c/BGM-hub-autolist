// app.js - BGM-HUB · 自動讀取 audio_list.txt 版
// 功能：
// 1. 讀取 audio/audio_list.txt 自動建立「群組(Tab)」與「按鍵(Button)」
// 2. 不再需要 audiodb.js、不用手寫 JS 陣列 / DB
// 3. 每個群組有自己的排序（localStorage 獨立記錄）
// 4. 使用 Web Audio API 播放，支援多軌同時播放、全部靜音

document.addEventListener("DOMContentLoaded", () => {
  initBgmHub();
});

async function initBgmHub() {
  const gridEl = document.getElementById("padGrid");
  const stopAllBtn = document.getElementById("stopAllBtn");
  const tabBarEl = document.getElementById("tabBar");

  const STORAGE_KEY_PREFIX = "BGMHubOrder:";
  const ACTIVE_GROUP_KEY = "BGMHubActiveGroup";

  // 由 audio_list.txt 解析出的資料
  let AUDIO_DB = [];      // [{ id, group, name, file }]
  let AUDIO_GROUPS = [];  // [{ id, label }]
  let activeGroup = "";   // 目前選擇的群組（= 子資料夾名）

  // ============== 讀取 audio_list.txt → 建 DB ==============
  async function loadAudioList() {
    try {
      const resp = await fetch("audio/audio_list.txt?_=" + Date.now());
      if (!resp.ok) {
        console.error("讀取 audio/audio_list.txt 失敗，HTTP 狀態碼：", resp.status);
        return null;
      }
      const text = await resp.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const entries = [];
      const groupSet = new Set();

      lines.forEach((raw) => {
        // 統一換成 /
        const clean = raw.replace(/\\/g, "/");
        // 必須從 audio/ 開頭
        if (!clean.startsWith("audio/")) return;

        const parts = clean.split("/");
        // audio/<group>/<file>
        if (parts.length < 3) return;

        const groupName = parts[1];           // 子資料夾名 = 群組名稱
        const filePath = clean;               // e.g. audio/綜藝音效/可惜.WAV
        const fileName = parts[parts.length - 1];
        const displayName = fileName.replace(/\.[^/.]+$/, ""); // 去掉副檔名

        const id = filePath; // 用完整路徑當 id，保證唯一

        entries.push({
          id,
          group: groupName,
          name: displayName,
          file: filePath
        });
        groupSet.add(groupName);
      });

      const groups = Array.from(groupSet).map((g) => ({
        id: g,
        label: g
      }));

      if (!entries.length || !groups.length) {
        console.warn("audio_list.txt 內沒有有效的項目。");
      }

      return {
        db: entries,
        groups
      };
    } catch (e) {
      console.error("載入 audio_list.txt 發生錯誤：", e);
      return null;
    }
  }

  // ============== Audio 引擎 ==============
  let audioCtx = null;
  const audioBuffers = new Map(); // id -> AudioBuffer
  const activeSources = new Map(); // id -> [{ source, gainNode }]
  const playButtons = new Map(); // id -> 對應按鈕

  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  async function loadBuffer(meta) {
    if (audioBuffers.has(meta.id)) return;
    const ctx = getAudioContext();
    try {
      const resp = await fetch(meta.file);
      const arrBuf = await resp.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrBuf);
      audioBuffers.set(meta.id, audioBuf);
    } catch (err) {
      console.error("載入音檔失敗：", meta.file, err);
    }
  }

  async function ensureBufferLoaded(meta) {
    if (audioBuffers.has(meta.id)) return;
    await loadBuffer(meta);
  }

  // 簡化：預設全部「同一鍵是 fade」，不同鍵可同時播放，不再有 TYPE / 三播放規則
  function playInstrument(meta, playBtn) {
    const ctx = getAudioContext();
    const buffer = audioBuffers.get(meta.id);
    if (!buffer) {
      console.warn("音檔尚未載入或 id 不存在：", meta.id);
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(1.0, ctx.currentTime);

    source.connect(gainNode).connect(ctx.destination);

    let list = activeSources.get(meta.id) || [];

    // 新的來了，舊的淡出（同一個鍵不會同時疊很多聲）
    const now = ctx.currentTime;
    list.forEach(({ source: oldSrc, gainNode: oldGain }) => {
      try {
        const g = oldGain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.25);
        oldSrc.stop(now + 0.3);
      } catch (_) {}
    });
    list = [];

    const entry = { source, gainNode };
    list.push(entry);
    activeSources.set(meta.id, list);

    playBtn.classList.add("is-playing");

    source.onended = () => {
      const arr = activeSources.get(meta.id) || [];
      const idx = arr.indexOf(entry);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) {
        activeSources.delete(meta.id);
        playBtn.classList.remove("is-playing");
      } else {
        activeSources.set(meta.id, arr);
      }
    };

    try {
      source.start();
    } catch (e) {
      console.warn("source start failed", e);
    }
  }

  function stopInstrument(meta, playBtn) {
    if (!audioCtx) {
      playBtn.classList.remove("is-playing");
      return;
    }
    const ctx = audioCtx;
    const list = activeSources.get(meta.id);
    if (!list || !list.length) {
      playBtn.classList.remove("is-playing");
      return;
    }

    const now = ctx.currentTime;
    list.forEach(({ source, gainNode }) => {
      try {
        const g = gainNode.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.15);
        g.linearRampToValueAtTime(0, now + 0.15);
        source.stop(now + 0.2);
      } catch (_) {}
    });

    activeSources.delete(meta.id);
    playBtn.classList.remove("is-playing");
  }

  function stopAllInstruments() {
    if (!audioCtx) {
      playButtons.forEach((btn) => btn.classList.remove("is-playing"));
      activeSources.clear();
      return;
    }

    const ctx = audioCtx;
    const now = ctx.currentTime;

    activeSources.forEach((list) => {
      list.forEach(({ source, gainNode }) => {
        try {
          const g = gainNode.gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(0, now + 0.12);
          source.stop(now + 0.15);
        } catch (_) {}
      });
    });

    activeSources.clear();
    playButtons.forEach((btn) => btn.classList.remove("is-playing"));
  }

  if (stopAllBtn) {
    stopAllBtn.addEventListener("click", () => {
      stopAllInstruments();
    });
  }

  // ============== 排序 / 群組工具 ==============

  function getStorageKeyForGroup(groupId) {
    return `${STORAGE_KEY_PREFIX}${groupId}`;
  }

  function loadOrder(groupId) {
    const key = getStorageKeyForGroup(groupId);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      return arr;
    } catch (e) {
      console.warn("Load order failed", e);
      return null;
    }
  }

  function saveOrder(groupId, order) {
    const key = getStorageKeyForGroup(groupId);
    try {
      localStorage.setItem(key, JSON.stringify(order));
    } catch (e) {
      console.warn("Save order failed", e);
    }
  }

  // 取得某群組的排序後清單
  function getOrderedList(groupId) {
    const itemsOfGroup = AUDIO_DB.filter((item) => item.group === groupId);
    const map = new Map();
    itemsOfGroup.forEach((item) => map.set(item.id, item));

    const savedOrder = loadOrder(groupId);
    const result = [];

    if (savedOrder && savedOrder.length > 0) {
      savedOrder.forEach((id) => {
        if (map.has(id)) {
          result.push(map.get(id));
          map.delete(id);
        }
      });
    }

    // 沒出現在 savedOrder 的（新加的）補上
    map.forEach((item) => {
      result.push(item);
    });

    return result;
  }

  // 建立單一卡片
  function createPadItem(meta) {
    const padItem = document.createElement("div");
    padItem.className = "pad-item";
    padItem.dataset.id = meta.id;
    padItem.setAttribute("draggable", "true");

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "audio-pad";

    const mainLabel = document.createElement("div");
    mainLabel.className = "audio-pad-label-main";
    mainLabel.textContent = meta.name; // 檔名（不含副檔名）

    playBtn.appendChild(mainLabel);

    playButtons.set(meta.id, playBtn);

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "audio-pad-stop";
    stopBtn.textContent = "停止這一軌";

    const handlePlayPointerDown = async (e) => {
      e.preventDefault();

      const ctx = getAudioContext();
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch (err) {
          console.warn("AudioContext resume failed", err);
        }
      }

      await ensureBufferLoaded(meta);
      playInstrument(meta, playBtn);
    };

    playBtn.addEventListener("pointerdown", handlePlayPointerDown);
    playBtn.addEventListener("click", (e) => {
      e.preventDefault();
    });

    stopBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stopInstrument(meta, playBtn);
    });

    padItem.appendChild(playBtn);
    padItem.appendChild(stopBtn);

    return padItem;
  }

  function saveActiveGroup(groupId) {
    try {
      localStorage.setItem(ACTIVE_GROUP_KEY, groupId);
    } catch (_) {}
  }

  // 渲染 Tabs
  function renderTabs() {
    if (!tabBarEl) return;
    tabBarEl.innerHTML = "";

    AUDIO_GROUPS.forEach((g) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab";
      if (g.id === activeGroup) {
        btn.classList.add("is-active");
      }
      btn.dataset.group = g.id;
      btn.textContent = g.label; // Tab 標籤 = 子資料夾名

      btn.addEventListener("click", () => {
        if (activeGroup === g.id) return;
        activeGroup = g.id;
        saveActiveGroup(activeGroup);
        updateTabActiveState();
        renderPads();
      });

      tabBarEl.appendChild(btn);
    });
  }

  function updateTabActiveState() {
    if (!tabBarEl) return;
    const tabs = tabBarEl.querySelectorAll(".tab");
    tabs.forEach((t) => {
      if (t.dataset.group === activeGroup) {
        t.classList.add("is-active");
      } else {
        t.classList.remove("is-active");
      }
    });
  }

  // 渲染目前群組的卡片
  function renderPads() {
    if (!gridEl) return;
    const list = getOrderedList(activeGroup);

    gridEl.innerHTML = "";
    playButtons.clear();

    list.forEach((meta) => {
      const padItem = createPadItem(meta);
      gridEl.appendChild(padItem);
    });

    initDragAndDrop();

    // 順便預載本群組音檔
    list.forEach((meta) => {
      loadBuffer(meta);
    });
  }

  // 拖曳排序：只影響目前群組
  function initDragAndDrop() {
    const items = Array.from(gridEl.querySelectorAll(".pad-item"));
    let dragSrcId = null;

    items.forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        dragSrcId = item.dataset.id;
        item.classList.add("dragging");
        try {
          e.dataTransfer.setData("text/plain", dragSrcId);
        } catch (_) {}
        e.dataTransfer.effectAllowed = "move";
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        dragSrcId = null;
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetId = item.dataset.id;
        if (!dragSrcId || !targetId || dragSrcId === targetId) return;

        const currentOrder = getOrderedList(activeGroup).map((it) => it.id);
        const fromIndex = currentOrder.indexOf(dragSrcId);
        const toIndex = currentOrder.indexOf(targetId);
        if (fromIndex === -1 || toIndex === -1) return;

        currentOrder.splice(toIndex, 0, currentOrder.splice(fromIndex, 1)[0]);
        saveOrder(activeGroup, currentOrder);
        renderPads();
      });
    });
  }

  // iOS 雙擊放大保護：只在 pad 區攔截
  (function preventIOSDoubleTapZoom() {
    if (!gridEl) return;
    let lastTouchEnd = 0;

    gridEl.addEventListener(
      "touchend",
      (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 350) {
          e.preventDefault();
        }
        lastTouchEnd = now;
      },
      { passive: false }
    );
  })();

  // ============== 啟動：先載入 audio_list.txt，再渲染 UI ==============
  const data = await loadAudioList();
  if (!data) {
    // 若 audio_list.txt 有問題，就不要再往下跑，避免整個 JS 爆掉
    if (gridEl) {
      gridEl.innerHTML = "<p style='font-size:0.85rem;color:#b00020;'>找不到 audio/audio_list.txt 或內容無效，請先在專案根目錄執行產生清單的指令。</p>";
    }
    return;
  }

  AUDIO_DB = data.db;
  AUDIO_GROUPS = data.groups;

  if (!AUDIO_GROUPS.length) {
    if (gridEl) {
      gridEl.innerHTML = "<p style='font-size:0.85rem;color:#b00020;'>audio_list.txt 沒有任何音檔路徑，請確認 audio 資料夾內有檔案。</p>";
    }
    return;
  }

  // 初始化 activeGroup（從 localStorage 或用第一個群組）
  (function initActiveGroup() {
    try {
      const saved = localStorage.getItem(ACTIVE_GROUP_KEY);
      if (saved && AUDIO_GROUPS.some((g) => g.id === saved)) {
        activeGroup = saved;
        return;
      }
    } catch (_) {}
    activeGroup = AUDIO_GROUPS[0].id;
  })();

  renderTabs();
  renderPads();
}
