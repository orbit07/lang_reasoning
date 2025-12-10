const STORAGE_KEY = 'lang-sns-data';
const DATA_VERSION = 3;
const STORAGE_LIMIT = 5 * 1024 * 1024; // 5MB approximate
const IMAGE_RESIZE_THRESHOLD = 1024 * 1024; // 1MB

const defaultData = () => ({
  version: DATA_VERSION,
  posts: [],
  puzzles: [],
  replies: [],
  images: {},
  lastId: 0,
});

const state = {
  data: defaultData(),
  currentTab: 'timeline',
  imageCache: new Map(),
  dashboardChart: null,
  hasPlayedDashboardAnimation: false,
};

const dashboardLanguages = [
  { value: 'en-US', label: '英語', color: '#2F6FE4' },
  { value: 'ko-KR', label: '韓国語', color: '#7AB7FF' },
  { value: 'zh-TW', label: '中国語', color: '#C5E0FF' },
];

const langOptions = [
  { value: 'ja', label: '日本語', speakable: false },
  { value: 'en-US', label: '英語', voiceHint: 'Samantha', speakable: true },
  { value: 'ko-KR', label: '韓国語', voiceHint: 'Yuna', speakable: true },
  { value: 'zh-TW', label: '台湾華語', voiceHint: 'Meijia', speakable: true },
];

const speakerOptions = [
  { value: 'me', label: 'わたし', icon: 'img/icon_me.png' },
  { value: 'friend', label: '友だち', icon: 'img/icon_friend.png' },
  { value: 'staff', label: '店員', icon: 'img/icon_staff.png' },
  { value: 'other', label: 'その他', icon: 'img/icon_other.png' },
  { value: 'none', label: '未指定', icon: 'img/icon_none.png' },
];

function createSpeakerIcon({ icon, label }) {
  const wrapper = document.createElement('span');
  wrapper.className = 'speaker-icon-wrapper';

  const img = document.createElement('img');
  img.src = icon;
  img.alt = label;
  img.width = 40;
  img.height = 40;

  const text = document.createElement('span');
  text.className = 'speaker-icon-label';
  text.textContent = label;

  wrapper.append(img, text);
  return wrapper;
}

const getLanguageLabel = (value) => langOptions.find((opt) => opt.value === value)?.label || value;

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.version !== DATA_VERSION) {
      state.data = { ...defaultData(), ...parsed, version: DATA_VERSION };
    } else {
      state.data = parsed;
    }
  } catch (e) {
    console.error('Failed to load data', e);
    state.data = defaultData();
  }

  ensureSpeakerFields(state.data);
  ensurePostFields(state.data);
  ensurePuzzleFields(state.data);
}

function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  enforceStorageLimit();
}

function nextId() {
  state.data.lastId += 1;
  return state.data.lastId;
}

function extractTags(texts) {
  const tagSet = new Set();
  const regex = /#([\p{L}\p{N}_-]+)/gu;
  texts.forEach((t) => {
    let m;
    while ((m = regex.exec(t.content))) {
      tagSet.add(m[1]);
    }
  });
  return Array.from(tagSet);
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function resizeIfNeeded(dataUrl) {
  if (dataUrl.length <= IMAGE_RESIZE_THRESHOLD) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = dataUrl;
  });
}

function ensureImageId(dataUrl) {
  // deduplicate identical images
  for (const [id, stored] of Object.entries(state.data.images)) {
    if (stored === dataUrl) return id;
  }
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.data.images[id] = dataUrl;
  return id;
}

function ensureSpeakerFields(data) {
  const sync = (items = []) => {
    items.forEach((item) => {
      (item.texts || []).forEach((text) => {
        const speaker = text.speaker || text.speaker_type || 'none';
        text.speaker = speaker;
        text.speaker_type = speaker;
      });
    });
  };

  sync(data?.posts);
  sync(data?.replies);
}

function ensurePostFields(data) {
  (data?.posts || []).forEach((post) => {
    const pinnedLegacy = post.pinned ?? post.liked ?? false;
    post.pinned = Boolean(pinnedLegacy);
    post.pinnedAt = post.pinned
      ? post.pinnedAt ?? post.likedAt ?? post.updatedAt ?? post.createdAt ?? Date.now()
      : null;
    delete post.liked;
    delete post.likedAt;

    if (post.sourceUrl === undefined) post.sourceUrl = null;
    if (!Array.isArray(post.linkedPuzzleIds)) post.linkedPuzzleIds = [];
  });
}

function ensurePuzzleFields(data) {
  const defaultReview = () => ({ intervalIndex: 0, nextReviewDate: null, history: [] });
  (data?.puzzles || []).forEach((puzzle, index) => {
    puzzle.id = puzzle.id || `puzzle_${index + 1}`;
    puzzle.text = puzzle.text || '';
    puzzle.language = puzzle.language || 'ja';
    puzzle.pronunciation = puzzle.pronunciation || '';
    puzzle.post = Array.isArray(puzzle.post)
      ? puzzle.post.map((ref) => ({
        postId: Number(ref.postId) || '',
        textIndex: Number(ref.textIndex) || 0,
      }))
      : [];
    puzzle.relatedPuzzleIds = Array.isArray(puzzle.relatedPuzzleIds) ? puzzle.relatedPuzzleIds : [];
    puzzle.notes = Array.isArray(puzzle.notes)
      ? puzzle.notes.map((note, idx) => ({
        id: note.id || `note_${idx + 1}`,
        text: note.text || '',
        createdAt: note.createdAt || puzzle.createdAt || Date.now(),
      }))
      : [];
    puzzle.isSolved = Boolean(puzzle.isSolved);
    puzzle.solvedAt = puzzle.isSolved ? puzzle.solvedAt || puzzle.updatedAt || puzzle.createdAt || null : null;
    puzzle.meaning = puzzle.meaning || '';
    puzzle.alternatives = Array.isArray(puzzle.alternatives) ? puzzle.alternatives : [];
    puzzle.examples = Array.isArray(puzzle.examples) ? puzzle.examples : [];
    puzzle.tags = Array.isArray(puzzle.tags) ? puzzle.tags : [];
    puzzle.review = puzzle.review || defaultReview();
    puzzle.createdAt = puzzle.createdAt || Date.now();
    puzzle.updatedAt = puzzle.updatedAt || puzzle.createdAt;
    puzzle.pinned = Boolean(puzzle.pinned);
    puzzle.pinnedAt = puzzle.pinned ? puzzle.pinnedAt || puzzle.updatedAt : null;
  });
}

function removeImageIfUnused(imageId) {
  if (!imageId) return;
  const used = state.data.posts.some((p) => p.imageId === imageId) ||
    state.data.replies.some((r) => r.imageId === imageId);
  if (!used) {
    delete state.data.images[imageId];
  }
}

function enforceStorageLimit() {
  let serialized = JSON.stringify(state.data);
  while (serialized.length > STORAGE_LIMIT) {
    // remove images from oldest posts first
    const candidates = [...state.data.posts]
      .filter((p) => p.imageId)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!candidates.length) break;
    const target = candidates[0];
    removeImageIfUnused(target.imageId);
    target.imageId = null;
    target.imageRemoved = true;
    serialized = JSON.stringify(state.data);
  }
  localStorage.setItem(STORAGE_KEY, serialized);
}

function updateScrollLock() {
  const modalOpen = !document.getElementById('modal').classList.contains('hidden');
  const imageOpen = !document.getElementById('image-viewer').classList.contains('hidden');
  document.body.classList.toggle('modal-open', modalOpen || imageOpen);
}

function showModalElement(modal) {
  modal.classList.remove('hidden', 'closing');
  requestAnimationFrame(() => modal.classList.add('active'));
  updateScrollLock();
}

function hideModalElement(modal) {
  let finished = false;
  const complete = () => {
    if (finished) return;
    finished = true;
    modal.classList.add('hidden');
    modal.classList.remove('closing');
    modal.removeEventListener('transitionend', complete);
    updateScrollLock();
  };

  modal.addEventListener('transitionend', complete);
  modal.classList.remove('active');
  modal.classList.add('closing');
  setTimeout(complete, 320);
}

function openModal(content, title = '投稿') {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const titleEl = document.getElementById('modal-title');
  titleEl.textContent = title;
  body.innerHTML = '';
  body.appendChild(content);
  showModalElement(modal);
}

function closeModal() {
  hideModalElement(document.getElementById('modal'));
}

function createSpeakerSelector(selected = 'me') {
  const wrapper = document.createElement('div');
  wrapper.className = 'speaker-select';

  const hiddenValue = document.createElement('input');
  hiddenValue.type = 'hidden';
  hiddenValue.className = 'speaker-select-value';
  hiddenValue.value = selected;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'speaker-select-trigger';

  const dropdown = document.createElement('div');
  dropdown.className = 'speaker-options';

  const updateTrigger = (value) => {
    hiddenValue.value = value;
    trigger.innerHTML = '';
    const selectedOpt = speakerOptions.find((opt) => opt.value === value) || speakerOptions[0];
    trigger.appendChild(createSpeakerIcon(selectedOpt));
  };

  speakerOptions.forEach((opt) => {
    const optionBtn = document.createElement('button');
    optionBtn.type = 'button';
    optionBtn.className = 'speaker-option';
    optionBtn.title = opt.label;
    optionBtn.setAttribute('aria-label', opt.label);

    optionBtn.appendChild(createSpeakerIcon(opt));
    optionBtn.addEventListener('click', () => {
      updateTrigger(opt.value);
      dropdown.classList.remove('open');
    });
    dropdown.appendChild(optionBtn);
  });

  trigger.addEventListener('click', () => {
    dropdown.classList.toggle('open');
  });

  const handleOutside = (e) => {
    if (!wrapper.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  };
  document.addEventListener('pointerdown', handleOutside);

  updateTrigger(selected);

  wrapper.append(hiddenValue, trigger, dropdown);
  return wrapper;
}

function createSpeakerBadge(type = 'none') {
  const info = speakerOptions.find((opt) => opt.value === type) || speakerOptions.find((opt) => opt.value === 'none');
  const badge = document.createElement('span');
  badge.className = 'speaker-badge';

  badge.append(createSpeakerIcon(info));
  return badge;
}

function createTextBlockInput(value = '', lang = 'ja', pronunciation = '', speakerType = 'me', removable = true, onRemove = null) {
  const wrapper = document.createElement('div');
  wrapper.className = 'text-area-wrapper';

  const speakerSelector = createSpeakerSelector(speakerType);
  wrapper.appendChild(speakerSelector);

  const fieldContainer = document.createElement('div');
  fieldContainer.className = 'text-area-fields';

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.className = 'text-area';
  fieldContainer.appendChild(textarea);

  const pronunciationInput = document.createElement('input');
  pronunciationInput.type = 'text';
  pronunciationInput.placeholder = '発音（任意）';
  pronunciationInput.className = 'pronunciation-input';
  pronunciationInput.value = pronunciation;
  fieldContainer.appendChild(pronunciationInput);

  const langRow = document.createElement('div');
  langRow.className = 'language-select';

  const select = document.createElement('select');
  select.className = 'language-select-input';
  langOptions.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === lang) option.selected = true;
    select.appendChild(option);
  });
  langRow.appendChild(select);

  const speakBtn = document.createElement('button');
  speakBtn.type = 'button';
  speakBtn.className = 'text-action-button language-select-button';
  speakBtn.innerHTML = '<img src="img/vol.svg" alt="" width="16" class="icon-inline"> 再生';
  speakBtn.addEventListener('click', () => playSpeech(textarea.value, select.value));
  langRow.appendChild(speakBtn);

  fieldContainer.appendChild(langRow);
  wrapper.appendChild(fieldContainer);
  if (removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
    removeBtn.addEventListener('click', () => {
      if (wrapper.parentElement.children.length > 1) {
        wrapper.remove();
        if (onRemove) onRemove();
      }
    });
    removeBtn.className = 'remove-text-btn';
    wrapper.appendChild(removeBtn);
  }
  return wrapper;
}

function buildPostForm({ mode = 'create', targetPost = null, parentId = null }) {
  const fragment = document.createDocumentFragment();
  const isReplyContext = mode === 'reply' || Boolean(targetPost?.postId);
  const container = document.createElement('div');
  container.className = 'modal-body-section';
  fragment.appendChild(container);
  const tagSection = document.createElement('div');
  tagSection.className = 'modal-tag-section';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = '#タグ をスペースまたはカンマ区切りで入力';
  tagInput.className = 'tag-input';
  if (targetPost?.tags?.length) {
    tagInput.value = targetPost.tags.map((t) => `#${t}`).join(' ');
  }
  tagSection.append(tagInput);
  const textAreaContainer = document.createElement('div');
  textAreaContainer.id = 'text-block-container';
  textAreaContainer.classList.add('text-block-container');
  let addBtn;

  const sourceSection = document.createElement('div');
  sourceSection.className = 'modal-tag-section';
  const sourceLabel = document.createElement('label');
  sourceLabel.className = 'tag-label';
  sourceLabel.textContent = '参考URL (sourceUrl)';
  const sourceInput = document.createElement('input');
  sourceInput.type = 'url';
  sourceInput.placeholder = 'https://example.com';
  sourceInput.className = 'tag-input';
  if (targetPost?.sourceUrl) sourceInput.value = targetPost.sourceUrl;
  sourceSection.append(sourceLabel, sourceInput);

  const puzzleSection = document.createElement('div');
  puzzleSection.className = 'modal-tag-section';
  const puzzleLabel = document.createElement('label');
  puzzleLabel.className = 'tag-label';
  puzzleLabel.textContent = '紐づく謎ID一覧 (linkedPuzzleIds)';
  const puzzleInput = document.createElement('input');
  puzzleInput.type = 'text';
  puzzleInput.placeholder = '1, 2, 3';
  puzzleInput.className = 'tag-input';
  if (targetPost?.linkedPuzzleIds?.length) puzzleInput.value = targetPost.linkedPuzzleIds.join(', ');
  puzzleSection.append(puzzleLabel, puzzleInput);

  const updateTextControls = () => {
    const count = textAreaContainer.children.length;
    if (addBtn) addBtn.disabled = count >= 4;
    const removeButtons = textAreaContainer.querySelectorAll('.remove-text-btn');
    removeButtons.forEach((btn) => {
      btn.disabled = count <= 1;
    });
  };

  const handleTextBlockChange = () => updateTextControls();

  const addTextBlock = (content = '', language = 'ja', pronunciation = '', speakerType = 'me') => {
    const block = createTextBlockInput(content, language, pronunciation, speakerType, true, handleTextBlockChange);
    textAreaContainer.appendChild(block);
    handleTextBlockChange();
  };

  if (targetPost) {
    textAreaContainer.innerHTML = '';
    const texts = targetPost.texts || [{ content: '', language: 'ja' }];
    texts.forEach((t) => addTextBlock(t.content, t.language, t.pronunciation || '', t.speaker_type || t.speaker || 'none'));
  } else {
    addTextBlock();
  }

  addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '＋';
  addBtn.className = 'add-text-button';
  addBtn.addEventListener('click', () => {
    if (textAreaContainer.children.length >= 4) return;
    addTextBlock();
  });

  updateTextControls();

  const imageRow = document.createElement('div');
  imageRow.className = 'form-row';
  const fileLabel = document.createElement('label');
  fileLabel.className = 'modal-file-button';
  fileLabel.innerHTML = '<img src="img/img_off.svg" alt="画像" width="25" class="icon-inline">'
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'file-input';
  fileLabel.appendChild(fileInput);

  const removeImageBtn = document.createElement('button');
  removeImageBtn.type = 'button';
  removeImageBtn.innerHTML = '<img src="img/delete.svg" alt="画像を削除" width="30" class="remove-image-icon icon-inline">';
  removeImageBtn.className = 'remove-image-btn';

  const imagePreview = document.createElement('div');
  imagePreview.className = 'image-preview';
  imageRow.appendChild(imagePreview);

  const originalImageId = targetPost?.imageId || null;
  const existingImageUrl = originalImageId ? state.data.images[originalImageId] : null;
  let imageDataUrl = null;
  let removeImage = false;

  const renderPreview = () => {
    imagePreview.innerHTML = '';
    const currentUrl = imageDataUrl || (!removeImage ? existingImageUrl : null);
    if (currentUrl) {
      const img = document.createElement('img');
      img.src = currentUrl;
      img.alt = '選択中の画像';
      img.className = 'image-preview-img';
      imagePreview.appendChild(img);
    }
    removeImageBtn.hidden = !currentUrl;
    if (currentUrl) {
      imagePreview.appendChild(removeImageBtn);
    }
    imageRow.style.display = imagePreview.childElementCount ? '' : 'none';
  };

  renderPreview();

  fileInput.addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    imageDataUrl = await resizeIfNeeded(dataUrl);
    removeImage = false;
    renderPreview();
  });

  removeImageBtn.addEventListener('click', () => {
    imageDataUrl = null;
    removeImage = true;
    fileInput.value = '';
    renderPreview();
  });

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-action-button';
  cancelBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
  cancelBtn.addEventListener('click', () => closeModal());
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'modal-primary-button primary-button modal-action-button';
  submitBtn.textContent = mode === 'reply' ? 'Reply' : mode === 'edit' ? 'Save' : 'Post';

  submitBtn.addEventListener('click', async () => {
    const textBlocks = Array.from(textAreaContainer.children).map((el) => {
      const speakerValue = el.querySelector('.speaker-select-value')?.value || 'me';
      return {
        content: el.querySelector('.text-area').value.trim(),
        language: el.querySelector('.language-select-input').value,
        pronunciation: el.querySelector('.pronunciation-input').value.trim(),
        speaker: speakerValue,
        speaker_type: speakerValue,
      };
    });
    const hasContent = textBlocks.some((t) => t.content.length > 0);
    if (!hasContent) {
      alert('テキストを入力してください。');
      return;
    }
    const tagsFromText = extractTags(textBlocks);
    const manualTags = tagInput.value
      .split(/[\s,、]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter((t) => t.length > 0);
    const tags = Array.from(new Set([...tagsFromText, ...manualTags]));
    let imageId = targetPost ? targetPost.imageId : null;

    if (imageDataUrl) {
      imageId = ensureImageId(imageDataUrl);
    } else if (removeImage) {
      imageId = null;
    }

    if (mode === 'reply') {
      const reply = {
        id: nextId(),
        postId: parentId,
        texts: textBlocks,
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        imageId: imageId || null,
        isDeleted: false,
      };
      state.data.replies.push(reply);
    } else if (mode === 'edit' && targetPost) {
      targetPost.texts = textBlocks;
      targetPost.tags = tags;
      if (!isReplyContext) {
        targetPost.sourceUrl = sourceInput.value.trim() || null;
        const puzzleIds = Array.from(new Set(
          puzzleInput.value
            .split(/[\s,、]+/)
            .map((t) => Number(t))
            .filter((n) => Number.isFinite(n)),
        ));
        targetPost.linkedPuzzleIds = puzzleIds;
      }
      targetPost.updatedAt = Date.now();
      if (imageDataUrl !== null) {
        targetPost.imageId = imageId;
        targetPost.imageRemoved = false;
        if (originalImageId && originalImageId !== imageId) {
          removeImageIfUnused(originalImageId);
        }
      } else if (removeImage) {
        removeImageIfUnused(originalImageId);
        targetPost.imageId = null;
        targetPost.imageRemoved = false;
      }
    } else {
      const post = {
        id: nextId(),
        texts: textBlocks,
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        imageId: imageId || null,
        imageRemoved: false,
        isDeleted: false,
        pinned: false,
        pinnedAt: null,
        sourceUrl: sourceInput.value.trim() || null,
        linkedPuzzleIds: Array.from(new Set(
          puzzleInput.value
            .split(/[\s,、]+/)
            .map((t) => Number(t))
            .filter((n) => Number.isFinite(n)),
        )),
      };
      state.data.posts.push(post);
    }

    persistData();
    closeModal();
    render();
  });

  actions.append(cancelBtn, fileLabel, submitBtn);

  container.appendChild(textAreaContainer);
  container.appendChild(addBtn);
  container.appendChild(imageRow);
  if (!isReplyContext) {
    fragment.appendChild(sourceSection);
    fragment.appendChild(puzzleSection);
  }
  fragment.appendChild(tagSection);
  fragment.appendChild(actions);
  return fragment;
}

function createAccordion(title, content, { open = false } = {}) {
  const details = document.createElement('details');
  details.className = 'accordion';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.append(summary, content);
  return details;
}

function parseTagInput(value) {
  return value
    .split(/[\s,、]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length > 0);
}

function buildPuzzleForm({ mode = 'create', targetPuzzle = null } = {}) {
  const fragment = document.createDocumentFragment();
  const container = document.createElement('div');
  container.className = 'modal-body-section puzzle-form';
  fragment.appendChild(container);

  const base = targetPuzzle || {
    id: '',
    text: '',
    language: 'ja',
    pronunciation: '',
    post: [{ postId: '', textIndex: 0 }],
    relatedPuzzleIds: [],
    notes: [{ id: `note_${Date.now()}`, text: '', createdAt: Date.now() }],
    isSolved: false,
    solvedAt: null,
    meaning: '',
    alternatives: [''],
    examples: [''],
    tags: [],
  };

  const tabNav = document.createElement('div');
  tabNav.className = 'puzzle-form-tabs';
  const tabButtons = {
    basic: document.createElement('button'),
    clue: document.createElement('button'),
    solution: document.createElement('button'),
  };
  tabButtons.basic.textContent = '基本情報';
  tabButtons.clue.textContent = '手がかり';
  tabButtons.solution.textContent = '解決';
  Object.values(tabButtons).forEach((btn) => btn.type = 'button');
  tabNav.append(tabButtons.basic, tabButtons.clue, tabButtons.solution);

  const sections = {
    basic: document.createElement('div'),
    clue: document.createElement('div'),
    solution: document.createElement('div'),
  };
  Object.values(sections).forEach((sec) => sec.className = 'puzzle-form-section');

  let activeTab = 'basic';
  const setActiveTab = (key) => {
    activeTab = key;
    Object.entries(tabButtons).forEach(([k, btn]) => btn.classList.toggle('active', k === key));
    Object.entries(sections).forEach(([k, sec]) => sec.classList.toggle('active', k === key));
  };

  const idRow = document.createElement('div');
  idRow.className = 'form-row';
  const idLabel = document.createElement('label');
  idLabel.className = 'tag-label';
  idLabel.textContent = 'Puzzle ID';
  const idValue = document.createElement('div');
  idValue.className = 'tag-input puzzle-id-display';
  idValue.textContent = targetPuzzle?.id || '保存時に自動採番';
  idRow.append(idLabel, idValue);

  const textRow = document.createElement('div');
  textRow.className = 'form-row';
  const textLabel = document.createElement('label');
  textLabel.className = 'tag-label';
  textLabel.textContent = 'テキスト';
  const textArea = document.createElement('textarea');
  textArea.className = 'text-area';
  textArea.value = base.text;
  textArea.placeholder = '謎の表面テキストを入力';
  textRow.append(textLabel, textArea);

  const langRow = document.createElement('div');
  langRow.className = 'language-select puzzle-language-row';
  const langSelect = document.createElement('select');
  langSelect.className = 'language-select-input';
  langOptions.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === base.language) option.selected = true;
    langSelect.appendChild(option);
  });
  const speakBtn = document.createElement('button');
  speakBtn.type = 'button';
  speakBtn.className = 'text-action-button text-label-button';
  speakBtn.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${getLanguageLabel(base.language)}`;
  speakBtn.addEventListener('click', () => playSpeech(textArea.value, langSelect.value));
  langSelect.addEventListener('change', () => {
    speakBtn.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${getLanguageLabel(langSelect.value)}`;
  });
  const pronunciationInput = document.createElement('input');
  pronunciationInput.type = 'text';
  pronunciationInput.className = 'pronunciation-input';
  pronunciationInput.placeholder = '発音（任意）';
  pronunciationInput.value = base.pronunciation;
  langRow.append(langSelect, speakBtn, pronunciationInput);

  const solvedRow = document.createElement('div');
  solvedRow.className = 'form-row solved-row';
  const solvedLabel = document.createElement('label');
  solvedLabel.className = 'tag-label';
  solvedLabel.textContent = '解決';
  const solvedToggle = document.createElement('button');
  solvedToggle.type = 'button';
  solvedToggle.className = 'toggle-button';
  solvedRow.append(solvedLabel, solvedToggle);

  const updateSolvedToggle = (flag) => {
    solvedToggle.classList.toggle('active', flag);
    solvedToggle.textContent = flag ? 'ON' : 'OFF';
    sections.solution.classList.toggle('hidden', !flag);
    tabButtons.solution.classList.toggle('hidden', !flag);
    if (flag) setActiveTab('solution');
    if (!flag && activeTab === 'solution') setActiveTab('basic');
  };
  solvedToggle.addEventListener('click', () => updateSolvedToggle(!solvedToggle.classList.contains('active')));
  updateSolvedToggle(Boolean(base.isSolved));

  sections.basic.append(idRow, textRow, langRow, solvedRow);

  const postContainer = document.createElement('div');
  postContainer.className = 'puzzle-multi-list';
  const postLabel = document.createElement('div');
  postLabel.className = 'tag-label';
  postLabel.textContent = '手がかり（post / textIndex）';
  const postList = document.createElement('div');
  postList.className = 'puzzle-field-list';
  const addPostBtn = document.createElement('button');
  addPostBtn.type = 'button';
  addPostBtn.className = 'add-text-button';
  addPostBtn.textContent = '＋';

  const createPostRow = (ref = { postId: '', textIndex: 0 }) => {
    const row = document.createElement('div');
    row.className = 'puzzle-ref-row';
    const postInput = document.createElement('input');
    postInput.type = 'number';
    postInput.placeholder = 'postId';
    postInput.className = 'tag-input';
    postInput.value = ref.postId ?? '';
    const indexInput = document.createElement('input');
    indexInput.type = 'number';
    indexInput.placeholder = 'textIndex';
    indexInput.className = 'tag-input';
    indexInput.value = ref.textIndex ?? 0;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-text-btn';
    remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
    remove.addEventListener('click', () => {
      if (postList.children.length > 1) row.remove();
    });
    row.append(postInput, indexInput, remove);
    return row;
  };

  (base.post.length ? base.post : [{ postId: '', textIndex: 0 }]).forEach((ref) => postList.appendChild(createPostRow(ref)));
  addPostBtn.addEventListener('click', () => postList.appendChild(createPostRow()));
  postContainer.append(postLabel, postList, addPostBtn);

  const relatedRow = document.createElement('div');
  relatedRow.className = 'form-row';
  const relatedLabel = document.createElement('label');
  relatedLabel.className = 'tag-label';
  relatedLabel.textContent = '関連する謎ID (relatedPuzzleIds)';
  const relatedInput = document.createElement('input');
  relatedInput.type = 'text';
  relatedInput.className = 'tag-input';
  relatedInput.placeholder = 'puzzle_0002, puzzle_0101';
  relatedInput.value = (base.relatedPuzzleIds || []).join(', ');
  relatedRow.append(relatedLabel, relatedInput);

  const notesContainer = document.createElement('div');
  notesContainer.className = 'puzzle-multi-list';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'tag-label';
  notesLabel.textContent = 'メモ (notes)';
  const notesList = document.createElement('div');
  notesList.className = 'puzzle-field-list';
  const addNoteBtn = document.createElement('button');
  addNoteBtn.type = 'button';
  addNoteBtn.className = 'add-text-button';
  addNoteBtn.textContent = '＋';

  const createNoteArea = (note) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'puzzle-note-row';
    const textarea = document.createElement('textarea');
    textarea.className = 'text-area';
    textarea.value = note?.text || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-text-btn';
    remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
    remove.addEventListener('click', () => {
      if (notesList.children.length > 1) wrapper.remove();
    });
    wrapper.append(textarea, remove);
    return wrapper;
  };
  (base.notes.length ? base.notes : [{}]).forEach((note) => notesList.appendChild(createNoteArea(note)));
  addNoteBtn.addEventListener('click', () => notesList.appendChild(createNoteArea({ text: '' })));
  notesContainer.append(notesLabel, notesList, addNoteBtn);

  sections.clue.append(postContainer, relatedRow, notesContainer);

  const meaningRow = document.createElement('div');
  meaningRow.className = 'form-row';
  const meaningLabel = document.createElement('label');
  meaningLabel.className = 'tag-label';
  meaningLabel.textContent = '意味 (meaning)';
  const meaningArea = document.createElement('textarea');
  meaningArea.className = 'text-area';
  meaningArea.placeholder = '解決した意味を入力';
  meaningArea.value = base.meaning;
  meaningRow.append(meaningLabel, meaningArea);

  const createTextList = (title, values = ['']) => {
    const wrap = document.createElement('div');
    wrap.className = 'puzzle-multi-list';
    const label = document.createElement('div');
    label.className = 'tag-label';
    label.textContent = title;
    const list = document.createElement('div');
    list.className = 'puzzle-field-list';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-text-button';
    addBtn.textContent = '＋';

    const createArea = (value = '') => {
      const row = document.createElement('div');
      row.className = 'puzzle-note-row';
      const area = document.createElement('textarea');
      area.className = 'text-area';
      area.value = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-text-btn';
      remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
      remove.addEventListener('click', () => {
        if (list.children.length > 1) row.remove();
      });
      row.append(area, remove);
      return row;
    };

    (values.length ? values : ['']).forEach((val) => list.appendChild(createArea(val)));
    addBtn.addEventListener('click', () => list.appendChild(createArea('')));
    wrap.append(label, list, addBtn);
    return wrap;
  };

  const alternativesWrap = createTextList('言い換え (alternatives)', base.alternatives?.length ? base.alternatives : ['']);
  const examplesWrap = createTextList('例文 (examples)', base.examples?.length ? base.examples : ['']);

  const tagsRow = document.createElement('div');
  tagsRow.className = 'form-row';
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'tag-label';
  tagsLabel.textContent = 'タグ';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'tag-input';
  tagsInput.placeholder = '#shopping #travel';
  tagsInput.value = (base.tags || []).map((t) => `#${t}`).join(' ');
  tagsRow.append(tagsLabel, tagsInput);

  sections.solution.append(meaningRow, alternativesWrap, examplesWrap, tagsRow);

  Object.entries(tabButtons).forEach(([key, btn]) => btn.addEventListener('click', () => setActiveTab(key)));
  setActiveTab('basic');

  container.append(tabNav, sections.basic, sections.clue, sections.solution);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-action-button';
  cancelBtn.innerHTML = '<img src="img/delete.svg" alt="キャンセル" width="25" class="icon-inline">';
  cancelBtn.addEventListener('click', closeModal);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'modal-action-button';
  deleteBtn.hidden = !targetPuzzle;
  deleteBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
  deleteBtn.addEventListener('click', () => {
    if (!targetPuzzle) return;
    const confirmed = window.confirm('この謎カードを削除しますか？');
    if (!confirmed) return;
    state.data.puzzles = state.data.puzzles.filter((p) => p.id !== targetPuzzle.id);
    persistData();
    closeModal();
    render();
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'modal-primary-button primary-button modal-action-button';
  submitBtn.textContent = mode === 'edit' ? 'Save' : 'Create';

  submitBtn.addEventListener('click', () => {
    const trimmedText = textArea.value.trim();
    if (!trimmedText.length) {
      alert('テキストを入力してください');
      return;
    }
    const isSolved = solvedToggle.classList.contains('active');
    const now = Date.now();
    const tagValues = parseTagInput(tagsInput.value);

    const postRefs = Array.from(postList.children).map((row) => ({
      postId: Number(row.querySelector('input[type="number"]')?.value) || '',
      textIndex: Number(row.querySelectorAll('input[type="number"]')[1]?.value) || 0,
    })).filter((ref) => ref.postId !== '');

    const noteTexts = Array.from(notesList.children).map((row, idx) => {
      const text = row.querySelector('textarea')?.value.trim() || '';
      return {
        id: base.notes[idx]?.id || `note_${Date.now()}_${idx}`,
        text,
        createdAt: base.notes[idx]?.createdAt || now,
      };
    }).filter((note) => note.text.length > 0);

    const collectList = (wrap) => Array.from(wrap.querySelectorAll('textarea')).map((el) => el.value.trim()).filter((v) => v.length);
    const alternatives = collectList(alternativesWrap);
    const examples = collectList(examplesWrap);
    const relatedIds = Array.from(new Set(parseTagInput(relatedInput.value)));

    if (mode === 'edit' && targetPuzzle) {
      targetPuzzle.text = trimmedText;
      targetPuzzle.language = langSelect.value;
      targetPuzzle.pronunciation = pronunciationInput.value.trim();
      targetPuzzle.post = postRefs;
      targetPuzzle.relatedPuzzleIds = relatedIds;
      targetPuzzle.notes = noteTexts;
      targetPuzzle.isSolved = isSolved;
      targetPuzzle.solvedAt = isSolved ? targetPuzzle.solvedAt || now : null;
      targetPuzzle.meaning = meaningArea.value.trim();
      targetPuzzle.alternatives = alternatives;
      targetPuzzle.examples = examples;
      targetPuzzle.tags = tagValues;
      targetPuzzle.updatedAt = now;
    } else {
      const puzzle = {
        id: `puzzle_${nextId()}`,
        text: trimmedText,
        language: langSelect.value,
        pronunciation: pronunciationInput.value.trim(),
        post: postRefs,
        relatedPuzzleIds: relatedIds,
        notes: noteTexts,
        isSolved,
        solvedAt: isSolved ? now : null,
        meaning: meaningArea.value.trim(),
        alternatives,
        examples,
        tags: tagValues,
        review: { intervalIndex: 0, nextReviewDate: null, history: [] },
        createdAt: now,
        updatedAt: now,
        pinned: false,
        pinnedAt: null,
      };
      state.data.puzzles.push(puzzle);
    }

    persistData();
    closeModal();
    render();
  });

  actions.append(cancelBtn, deleteBtn, submitBtn);
  fragment.appendChild(actions);
  return fragment;
}

function playSpeech(text, lang) {
  if (!text || lang === 'ja') return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const hint = langOptions.find((l) => l.value === lang)?.voiceHint;
  if (hint) {
    const voice = voices.find((v) => v.name.includes(hint));
    if (voice) utter.voice = voice;
  }
  window.speechSynthesis.speak(utter);
}

function collectTextEntries() {
  const entries = [];
  const pushEntries = (items) => {
    items.forEach((item) => {
      const createdAt = item.createdAt;
      (item.texts || []).forEach((text) => {
        const content = text.content?.trim() || '';
        if (!content.length) return;
        entries.push({
          language: text.language,
          createdAt,
        });
      });
    });
  };
  pushEntries(state.data.posts);
  pushEntries(state.data.replies);
  pushEntries((state.data.puzzles || []).map((puzzle) => ({
    createdAt: puzzle.createdAt,
    texts: [{ content: puzzle.text, language: puzzle.language }],
  })));
  return entries;
}

function getDateKey(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getHeatmapColor(count) {
  if (count === 0) return 'rgba(255, 255, 255, .5)';
  if (count <= 2) return '#C5E0FF';
  if (count <= 4) return '#7AB7FF';
  return '#2F6FE4';
}

function render() {
  renderTimeline();
  renderPuzzles();
  runSearch();
  if (state.currentTab === 'dashboard') {
    renderDashboard();
  }
}

function renderDashboard() {
  const chartContainer = document.getElementById('dashboard-chart-container');
  const countsContainer = document.getElementById('dashboard-text-counts');
  const heatmapContainer = document.getElementById('dashboard-heatmap-container');
  if (!chartContainer || !countsContainer || !heatmapContainer) return;

  const entries = collectTextEntries();
  const counts = { 'en-US': 0, 'ko-KR': 0, 'zh-TW': 0 };
  entries.forEach((entry) => {
    if (entry.language === 'ja') return;
    if (Object.prototype.hasOwnProperty.call(counts, entry.language)) counts[entry.language] += 1;
  });
  const total = Object.values(counts).reduce((sum, val) => sum + val, 0);

  chartContainer.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'dashboard-chart-canvas';
  chartContainer.appendChild(canvas);

  const centerTotal = document.createElement('div');
  centerTotal.className = 'dashboard-count-total dashboard-chart-total';
  centerTotal.textContent = total;
  chartContainer.appendChild(centerTotal);

  const chartData = {
    labels: dashboardLanguages.map((l) => l.label),
    datasets: [
      {
        data: dashboardLanguages.map((l) => counts[l.value]),
        backgroundColor: dashboardLanguages.map((l) => l.color),
        borderWidth: 0,
      },
    ],
  };

  // 👇 Chart.js はまだ描画しない（ここが重要）
  if (state.dashboardChart) {
    state.dashboardChart.destroy();
    state.dashboardChart = null;
  }

  // ✅ レイアウト確定後（1フレーム後）に描画
  requestAnimationFrame(() => {
    // ① Canvasサイズ確定
    const w = 113;
    const h = 113; // 好きな高さ
    canvas.width = w;
    canvas.height = h;

    // ② Chart生成 (ここで初めてOK)
    state.dashboardChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: chartData,
      options: {
        responsive: false,   // ← Canvas拡大で0に戻されるのを防止
        rotation: -90 * (Math.PI / 180),
        cutout: '70%',
        animation: {
          animateRotate: true,
          animateScale: false,
          duration: 1200
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${context.raw} texts`,
            },
          },
        },
      },
    });
  });

  // ===== ここより下はそのままでOK ↓ =====

  state.hasPlayedDashboardAnimation = true;

  countsContainer.innerHTML = '';
  dashboardLanguages.forEach((lang) => {
    const row = document.createElement('div');
    row.className = 'dashboard-count-item';
    const swatch = document.createElement('span');
    swatch.className = 'dashboard-count-swatch';
    swatch.style.backgroundColor = lang.color;
    const label = document.createElement('span');
    label.textContent = `${lang.label}: ${counts[lang.value]}`;
    row.append(swatch, label);
    countsContainer.appendChild(row);
  });

  const filteredEntries = entries.filter((entry) => Object.prototype.hasOwnProperty.call(counts, entry.language));
  const dateCounts = new Map();
  filteredEntries.forEach((entry) => {
    const key = getDateKey(entry.createdAt);
    dateCounts.set(key, (dateCounts.get(key) || 0) + 1);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 364; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = getDateKey(date);
    days.push({ date, key, count: dateCounts.get(key) || 0 });
  }

  const startOffset = days[0].date.getDay();
  const columns = [];
  let column = [];
  for (let i = 0; i < startOffset; i += 1) {
    column.push(null);
  }
  days.forEach((day) => {
    column.push(day);
    if (column.length === 7) {
      columns.push(column);
      column = [];
    }
  });
  if (column.length) columns.push(column);

  heatmapContainer.innerHTML = '';
  const scrollArea = document.createElement('div');
  scrollArea.className = 'heatmap-scroll-area';

  const monthsRow = document.createElement('div');
  monthsRow.className = 'heatmap-months';

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let lastMonth = null;
  columns.forEach((col) => {
    const firstDay = col.find((cell) => cell);
    const currentMonth = firstDay ? firstDay.date.getMonth() : lastMonth;
    const monthLabel = currentMonth !== null && currentMonth !== lastMonth ? monthLabels[currentMonth] : '';

    const monthEl = document.createElement('div');
    monthEl.className = 'heatmap-month';
    monthEl.textContent = monthLabel;
    monthsRow.appendChild(monthEl);

    const colEl = document.createElement('div');
    colEl.className = 'heatmap-column';
    col.forEach((cell) => {
      const cellEl = document.createElement('div');
      cellEl.className = 'heatmap-cell';
      if (cell) {
        cellEl.style.backgroundColor = getHeatmapColor(cell.count);
        cellEl.title = `${cell.key}: ${cell.count} texts`;
      }
      colEl.appendChild(cellEl);
    });
    grid.appendChild(colEl);

    if (firstDay) {
      lastMonth = firstDay.date.getMonth();
    }
  });

  scrollArea.append(monthsRow, grid);

  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  const legendItems = [
    { label: '0', count: 0 },
    { label: '1-2', count: 1 },
    { label: '3-4', count: 3 },
    { label: '5+', count: 5 },
  ];
  legendItems.forEach(({ label, count }) => {
    const item = document.createElement('span');
    item.className = 'heatmap-legend-item';
    const sample = document.createElement('div');
    sample.className = 'heatmap-cell';
    sample.style.backgroundColor = getHeatmapColor(count);
    item.append(sample);
    legend.appendChild(item);
  });

  heatmapContainer.append(scrollArea, legend);

  // 最新が右端なので、右端から表示
  requestAnimationFrame(() => {
    scrollArea.scrollLeft = scrollArea.scrollWidth;
  });
}


function renderCardList(container, items, { emptyMessage, highlightImage = false } = {}) {
  if (container._infiniteObserver) {
    container._infiniteObserver.disconnect();
  }
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const initialCount = 50;
  const batchSize = 20;
  let index = 0;
  let observer = null;

  const addSentinel = () => {
    const sentinel = document.createElement('div');
    sentinel.className = 'load-sentinel';
    container.appendChild(sentinel);
    if (observer) observer.observe(sentinel);
  };

  const renderBatch = (count) => {
    const slice = items.slice(index, index + count);
    slice.forEach((post) => container.appendChild(renderPostCard(post, { highlightImage })));
    index += count;
    if (index < items.length) addSentinel();
  };

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        entry.target.remove();
        renderBatch(batchSize);
      }
    });
  }, { root: null, rootMargin: '200px' });

  renderBatch(initialCount);
  container._infiniteObserver = observer;
}

function renderTimeline() {
  const container = document.getElementById('timeline-list');
  const sorted = [...state.data.posts].sort((a, b) => b.createdAt - a.createdAt);
  renderCardList(container, sorted, { emptyMessage: '投稿がありません。' });
}

function renderPuzzleTagList(tags = []) {
  const wrap = document.createElement('div');
  wrap.className = 'tag-list';
  tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = `#${tag}`;
    wrap.appendChild(chip);
  });
  return wrap;
}

function renderPuzzleCard(puzzle) {
  const card = document.createElement('article');
  card.className = 'card puzzle-card';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const created = document.createElement('span');
  created.className = 'card-meta-item';
  created.textContent = formatDate(puzzle.updatedAt || puzzle.createdAt);
  const status = document.createElement('span');
  status.className = puzzle.isSolved ? 'puzzle-status solved' : 'puzzle-status';
  status.textContent = puzzle.isSolved ? '解決済' : '未解決';
  meta.append(created, status);

  const body = document.createElement('div');
  body.className = 'card-body puzzle-body';

  const basic = document.createElement('div');
  basic.className = 'puzzle-basic';
  const header = document.createElement('div');
  header.className = 'puzzle-basic-header';
  const langLabel = getLanguageLabel(puzzle.language);
  const speakBtn = document.createElement('button');
  speakBtn.type = 'button';
  speakBtn.className = 'text-action-button text-label-button';
  speakBtn.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${langLabel}`;
  speakBtn.addEventListener('click', () => playSpeech(puzzle.text, puzzle.language));
  const langText = document.createElement('span');
  langText.className = 'puzzle-language-label';
  langText.textContent = langLabel;
  header.append(speakBtn, langText);

  const textBlock = document.createElement('div');
  textBlock.className = 'puzzle-text';
  textBlock.textContent = puzzle.text;

  basic.append(header, textBlock);
  if (puzzle.pronunciation) {
    const pron = document.createElement('div');
    pron.className = 'pronunciation';
    pron.textContent = puzzle.pronunciation;
    basic.appendChild(pron);
  }
  body.appendChild(basic);

  const clueContent = document.createElement('div');
  clueContent.className = 'puzzle-section-content';
  if (puzzle.post?.length) {
    const list = document.createElement('ul');
    list.className = 'puzzle-ref-list';
    puzzle.post.forEach((ref) => {
      const item = document.createElement('li');
      item.textContent = `Post #${ref.postId} / textIndex ${ref.textIndex}`;
      list.appendChild(item);
    });
    clueContent.appendChild(list);
  } else {
    const helper = document.createElement('div');
    helper.className = 'helper';
    helper.textContent = '手がかりがまだ登録されていません。';
    clueContent.appendChild(helper);
  }

  if (puzzle.relatedPuzzleIds?.length) {
    const related = document.createElement('div');
    related.className = 'puzzle-chip-list';
    puzzle.relatedPuzzleIds.forEach((id) => {
      const chip = document.createElement('span');
      chip.className = 'puzzle-chip';
      chip.textContent = `#${id}`;
      related.appendChild(chip);
    });
    clueContent.appendChild(related);
  }

  if (puzzle.notes?.length) {
    const notesWrap = document.createElement('div');
    notesWrap.className = 'puzzle-note-list';
    puzzle.notes.forEach((note) => {
      const noteEl = document.createElement('div');
      noteEl.className = 'puzzle-note';
      noteEl.textContent = note.text;
      notesWrap.appendChild(noteEl);
    });
    clueContent.appendChild(notesWrap);
  }
  body.appendChild(createAccordion('手がかり', clueContent));

  if (puzzle.isSolved) {
    const solvedContent = document.createElement('div');
    solvedContent.className = 'puzzle-section-content';

    const meaning = document.createElement('div');
    meaning.className = 'puzzle-meaning';
    meaning.textContent = puzzle.meaning || '未入力';
    solvedContent.appendChild(meaning);

    const renderList = (title, values = []) => {
      if (!values.length) return;
      const wrap = document.createElement('div');
      wrap.className = 'puzzle-list-block';
      const label = document.createElement('div');
      label.className = 'puzzle-list-label';
      label.textContent = title;
      const list = document.createElement('ul');
      values.forEach((val) => {
        const item = document.createElement('li');
        item.textContent = val;
        list.appendChild(item);
      });
      wrap.append(label, list);
      solvedContent.appendChild(wrap);
    };
    renderList('言い換え', puzzle.alternatives || []);
    renderList('例文', puzzle.examples || []);

    if (puzzle.tags?.length) {
      const tags = renderPuzzleTagList(puzzle.tags);
      solvedContent.appendChild(tags);
    }

    body.appendChild(createAccordion('解決', solvedContent));
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'card-action-button';
  editBtn.innerHTML = '<img src="img/edit.svg" alt="編集" width="20" class="icon-inline">';
  editBtn.addEventListener('click', () => openModal(buildPuzzleForm({ mode: 'edit', targetPuzzle: puzzle }), '謎カードを編集'));

  const solvedBtn = document.createElement('button');
  solvedBtn.className = 'card-action-button';
  solvedBtn.textContent = puzzle.isSolved ? '未解決に戻す' : '解決ボタン';
  solvedBtn.addEventListener('click', () => togglePuzzleSolved(puzzle.id));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-action-button danger-action-button';
  deleteBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
  deleteBtn.addEventListener('click', () => deletePuzzle(puzzle.id));

  actions.append(editBtn, solvedBtn, deleteBtn);

  card.append(meta, body, actions);
  return card;
}

function renderPuzzles() {
  const container = document.getElementById('puzzle-list');
  if (!container) return;
  container.innerHTML = '';
  const puzzles = [...(state.data.puzzles || [])]
    .sort((a, b) => (b.pinned === a.pinned ? (b.updatedAt || 0) - (a.updatedAt || 0) : Number(b.pinned) - Number(a.pinned)));
  if (!puzzles.length) {
    container.innerHTML = '<div class="empty-state">謎の投稿がありません。</div>';
    return;
  }
  puzzles.forEach((puzzle) => container.appendChild(renderPuzzleCard(puzzle)));
}

function renderImages() {
  const container = document.getElementById('images-list');
  const posts = state.data.posts.filter((p) => p.imageId && state.data.images[p.imageId]);
  posts.sort((a, b) => b.createdAt - a.createdAt);
  renderCardList(container, posts, { emptyMessage: '画像付きポストはありません。', highlightImage: true });
}

function renderPostCard(post, options = {}) {
  const template = document.getElementById('post-template');
  const node = template.content.firstElementChild.cloneNode(true);
  const meta = node.querySelector('.card-meta');
  const body = node.querySelector('.card-body');
  const tagsEl = node.querySelector('.tag-list');
  const actions = node.querySelector('.card-actions');
  const repliesWrap = node.querySelector('.replies');

  meta.innerHTML = '';
  const metaText = document.createElement('span');
  metaText.className = 'card-meta-item';
  metaText.textContent = `${formatDate(post.createdAt)}${post.updatedAt && post.updatedAt !== post.createdAt ? '（Edited）' : ''}`;
  meta.appendChild(metaText);

  body.innerHTML = '';
  if (post.isDeleted) {
    body.innerHTML = '<div class="text-block">このポストは削除されました</div>';
  } else {
    post.texts.forEach((t) => {
      const blockGroup = document.createElement('div');
      blockGroup.className = 'text-block-group';
      const speakerBadge = createSpeakerBadge(t.speaker_type || t.speaker || 'none');
      blockGroup.appendChild(speakerBadge);

      const block = document.createElement('div');
      block.className = 'text-block';
      const label = document.createElement('div');
      label.className = 'text-label';
      const languageLabel = getLanguageLabel(t.language);
      const option = langOptions.find((opt) => opt.value === t.language);
      if (option?.speakable) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'text-action-button text-label-button';
        play.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${languageLabel}`;
        play.addEventListener('click', () => playSpeech(t.content, t.language));
        label.appendChild(play);
      } else {
        const langText = document.createElement('span');
        langText.textContent = languageLabel;
        label.appendChild(langText);
      }
      const content = document.createElement('div');
      content.className = 'text-content';
      content.textContent = t.content;
      block.append(label, content);

      if (t.pronunciation) {
        const pronunciation = document.createElement('div');
        pronunciation.className = 'pronunciation';
        pronunciation.textContent = t.pronunciation;
        block.appendChild(pronunciation);
      }
      blockGroup.appendChild(block);
      body.appendChild(blockGroup);
    });

    if (post.imageRemoved) {
      const removed = document.createElement('div');
      removed.className = 'helper';
      removed.textContent = '画像は容量制限のため削除されました';
      body.appendChild(removed);
    } else if (post.imageId && state.data.images[post.imageId]) {
      const img = document.createElement('img');
      img.src = state.data.images[post.imageId];
      img.alt = '投稿画像';
      img.className = options.highlightImage ? 'image-thumb highlight' : 'image-thumb';
      img.addEventListener('click', () => openImageViewer(img.src));
      body.appendChild(img);
    }
  }

  tagsEl.innerHTML = '';
  post.tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = `#${tag}`;
    chip.addEventListener('click', () => {
      document.querySelector('.tabs button[data-tab="search"]').click();
      document.getElementById('search-input').value = `#${tag}`;
      runSearch();
    });
    tagsEl.appendChild(chip);
  });
  tagsEl.style.display = post.tags.length ? '' : 'none';

  if (!post.isDeleted) {
    const extra = document.createElement('div');
    extra.className = 'post-extra';
    if (post.sourceUrl) {
      const sourceRow = document.createElement('div');
      sourceRow.className = 'post-extra-row';
      sourceRow.innerHTML = '<span class="post-extra-label">参考URL:</span>';
      const link = document.createElement('a');
      link.href = post.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = post.sourceUrl;
      link.className = 'post-extra-link';
      sourceRow.appendChild(link);
      extra.appendChild(sourceRow);
    }
    if (post.linkedPuzzleIds?.length) {
      const puzzleRow = document.createElement('div');
      puzzleRow.className = 'post-extra-row';
      const label = document.createElement('span');
      label.className = 'post-extra-label';
      label.textContent = '紐づく謎ID:';
      puzzleRow.appendChild(label);
      const list = document.createElement('div');
      list.className = 'puzzle-chip-list';
      post.linkedPuzzleIds.forEach((id) => {
        const chip = document.createElement('span');
        chip.className = 'puzzle-chip';
        chip.textContent = `#${id}`;
        list.appendChild(chip);
      });
      puzzleRow.appendChild(list);
      extra.appendChild(puzzleRow);
    }
    if (extra.childElementCount) {
      body.appendChild(extra);
    }
  }

  actions.innerHTML = '';
  if (!post.isDeleted) {
    const delBtn = document.createElement('button');
    delBtn.className = 'card-action-button danger-action-button';
    delBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
    delBtn.addEventListener('click', () => deletePost(post.id));

    const editBtn = document.createElement('button');
    editBtn.className = 'card-action-button';
    editBtn.innerHTML = '<img src="img/edit.svg" alt="編集" width="20" class="icon-inline">';
    editBtn.addEventListener('click', () => openModal(buildPostForm({ mode: 'edit', targetPost: post }), '投稿を編集'));

    const replyBtn = document.createElement('button');
    replyBtn.className = 'card-action-button';
    replyBtn.innerHTML = '<img src="img/reply.svg" alt="返信" width="20" class="icon-inline">';
    replyBtn.addEventListener('click', () => openModal(buildPostForm({ mode: 'reply', parentId: post.id }), '返信'));

    const pinBtn = document.createElement('button');
    pinBtn.className = 'card-action-button';
    pinBtn.innerHTML = post.pinned
      ? '<img src="img/hart_on.svg" alt="ピン留め中" width="20" class="icon-inline">'
      : '<img src="img/hart_off.svg" alt="ピン留め" width="20" class="icon-inline">';
    if (post.pinned) pinBtn.classList.add('liked');
    pinBtn.addEventListener('click', () => togglePinned(post.id));

    actions.append(delBtn, editBtn, replyBtn, pinBtn);
  }

  const rels = state.data.replies
    .filter((r) => r.postId === post.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  repliesWrap.innerHTML = '';
  rels.forEach((reply) => {
    const card = document.createElement('div');
    card.className = 'reply-card';
    const metaRow = document.createElement('div');
    metaRow.className = 'card-meta';
    const metaText = document.createElement('span');
    metaText.className = 'card-meta-item';
    metaText.textContent = formatDate(reply.createdAt);
    metaRow.appendChild(metaText);
    const bodyRow = document.createElement('div');
    bodyRow.className = 'card-body';
    reply.texts.forEach((t) => {
      const blockGroup = document.createElement('div');
      blockGroup.className = 'text-block-group';
      const speakerBadge = createSpeakerBadge(t.speaker_type || t.speaker || 'none');
      blockGroup.appendChild(speakerBadge);

      const block = document.createElement('div');
      block.className = 'text-block';
      const label = document.createElement('div');
      label.className = 'text-label';
      const languageLabel = getLanguageLabel(t.language);
      const option = langOptions.find((opt) => opt.value === t.language);
      if (option?.speakable) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'text-action-button text-label-button';
        play.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${languageLabel}`;
        play.addEventListener('click', () => playSpeech(t.content, t.language));
        label.appendChild(play);
      } else {
        const langText = document.createElement('span');
        langText.textContent = languageLabel;
        label.appendChild(langText);
      }
      const content = document.createElement('div');
      content.className = 'text-content';
      content.textContent = t.content;
      block.append(label, content);
      if (t.pronunciation) {
        const pronunciation = document.createElement('div');
        pronunciation.className = 'pronunciation';
        pronunciation.textContent = t.pronunciation;
        block.appendChild(pronunciation);
      }
      blockGroup.appendChild(block);
      bodyRow.appendChild(blockGroup);
    });
    if (reply.imageId && state.data.images[reply.imageId]) {
      const img = document.createElement('img');
      img.src = state.data.images[reply.imageId];
      img.className = 'image-thumb';
      img.alt = 'リプライ画像';
      img.addEventListener('click', () => openImageViewer(img.src));
      bodyRow.appendChild(img);
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'card-actions reply-card-actions';
    const delReply = document.createElement('button');
    delReply.className = 'card-action-button danger-action-button';
    delReply.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
    delReply.addEventListener('click', () => deleteReply(reply.id));
    const editReply = document.createElement('button');
    editReply.className = 'card-action-button';
    editReply.innerHTML = '<img src="img/edit.svg" alt="編集" width="20" class="icon-inline">';
    editReply.addEventListener('click', () => openModal(buildPostForm({ mode: 'edit', targetPost: reply }), 'リプライを編集'));
    actionsRow.append(delReply, editReply);

    card.append(metaRow, bodyRow, actionsRow);
    repliesWrap.appendChild(card);
  });
  repliesWrap.style.display = rels.length ? '' : 'none';

  return node;
}

function openImageViewer(src) {
  const viewer = document.getElementById('image-viewer');
  const img = document.getElementById('full-image');
  img.src = src;
  showModalElement(viewer);
}

function closeImageViewer() {
  hideModalElement(document.getElementById('image-viewer'));
}

function deletePost(id) {
  const post = state.data.posts.find((p) => p.id === id);
  if (!post) return;
  const confirmed = window.confirm('このポストを削除しますか？');
  if (!confirmed) return;
  const hasReplies = state.data.replies.some((r) => r.postId === id);
  if (hasReplies) {
    post.isDeleted = true;
    post.texts = [{ content: '', language: 'ja' }];
  } else {
    removeImageIfUnused(post.imageId);
    state.data.posts = state.data.posts.filter((p) => p.id !== id);
  }
  persistData();
  render();
}

function deleteReply(id) {
  const target = state.data.replies.find((r) => r.id === id);
  if (!target) return;
  const confirmed = window.confirm('このリプライを削除しますか？');
  if (!confirmed) return;
  removeImageIfUnused(target.imageId);
  state.data.replies = state.data.replies.filter((r) => r.id !== id);
  persistData();
  render();
}

function deletePuzzle(id) {
  const target = state.data.puzzles.find((p) => p.id === id);
  if (!target) return;
  const confirmed = window.confirm('この謎カードを削除しますか？');
  if (!confirmed) return;
  state.data.puzzles = state.data.puzzles.filter((p) => p.id !== id);
  persistData();
  render();
}

function togglePinned(id) {
  const post = state.data.posts.find((p) => p.id === id);
  if (!post || post.isDeleted) return;
  post.pinned = !post.pinned;
  post.pinnedAt = post.pinned ? Date.now() : null;
  persistData();
  render();
}

function toggleSearchPinnedFilter() {
  const btn = document.getElementById('search-pin-btn');
  if (!btn) return;
  const nextState = !btn.classList.contains('active');
  btn.classList.toggle('active', nextState);
  btn.setAttribute('aria-pressed', nextState);
  const icon = btn.querySelector('img');
  if (icon) icon.src = nextState ? 'img/hart_on.svg' : 'img/hart_off.svg';
}

function togglePuzzleSolved(id) {
  const puzzle = state.data.puzzles.find((p) => p.id === id);
  if (!puzzle) return;
  puzzle.isSolved = !puzzle.isSolved;
  puzzle.solvedAt = puzzle.isSolved ? puzzle.solvedAt || Date.now() : null;
  puzzle.updatedAt = Date.now();
  persistData();
  render();
}

function isSearchPinnedFilterActive() {
  return document.getElementById('search-pin-btn')?.classList.contains('active');
}

function runSearch() {
  const query = document.getElementById('search-input').value.trim();
  const container = document.getElementById('search-results');
  const terms = query.split(/\s+/).filter(Boolean);
  let tagFilter = null;
  const textTerms = [];
  terms.forEach((t) => {
    if (t.startsWith('#')) tagFilter = t.slice(1);
    else textTerms.push(t);
  });

  let results = state.data.posts.filter((p) => !p.isDeleted);
  if (tagFilter) {
    const tagLower = tagFilter.toLowerCase();
    results = results.filter((p) => p.tags.some((tag) => tag.toLowerCase() === tagLower));
  }
  if (textTerms.length) {
    const lowerTerms = textTerms.map((t) => t.toLowerCase());
    results = results.filter((p) => lowerTerms.every((term) => p.texts.some((t) => t.content.toLowerCase().includes(term))));
  }
  if (isSearchPinnedFilterActive()) {
    results = results.filter((p) => p.pinned);
  }
  results.sort((a, b) => b.createdAt - a.createdAt);

  renderCardList(container, results, { emptyMessage: '検索結果がありません。' });
}

function getUpdatedTimestamp(item) {
  return (item?.updatedAt || item?.createdAt || 0);
}

function mergeCollections(existing, incoming) {
  const map = new Map();
  (existing || []).forEach((item) => {
    if (item?.id == null) return;
    map.set(item.id, item);
  });

  (incoming || []).forEach((item) => {
    if (item?.id == null) return;
    if (!map.has(item.id)) {
      map.set(item.id, item);
      return;
    }
    const current = map.get(item.id);
    const shouldReplace = getUpdatedTimestamp(item) > getUpdatedTimestamp(current);
    map.set(item.id, shouldReplace ? { ...current, ...item } : current);
  });

  return Array.from(map.values());
}

function mergeImportedData(incoming) {
  if (!incoming || typeof incoming !== 'object') throw new Error('invalid data');
  const merged = { ...defaultData(), ...state.data };

  merged.posts = mergeCollections(merged.posts, incoming.posts || []);
  merged.puzzles = mergeCollections(merged.puzzles, incoming.puzzles || []);
  merged.replies = mergeCollections(merged.replies, incoming.replies || []);
  merged.images = { ...merged.images };
  Object.entries(incoming.images || {}).forEach(([id, dataUrl]) => {
    if (!merged.images[id]) merged.images[id] = dataUrl;
  });

  const incomingLastId = Number(incoming.lastId) || 0;
  const maxExistingId = Math.max(
    0,
    ...merged.posts.map((p) => Number(p.id) || 0),
    ...merged.replies.map((r) => Number(r.id) || 0),
    merged.lastId || 0,
  );
  merged.lastId = Math.max(maxExistingId, incomingLastId);
  merged.version = DATA_VERSION;

  state.data = merged;
  ensureSpeakerFields(state.data);
  ensurePostFields(state.data);
  ensurePuzzleFields(state.data);
  persistData();
  render();
}

function importFromJsonString(text) {
  const json = JSON.parse(text);
  mergeImportedData(json);
}

function importConversationMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('invalid conversation data');
  }

  const normalizeMessage = (msg) => {
    if (!msg || typeof msg !== 'object') throw new Error('invalid message');
    const content = String(msg.content || '').trim();
    if (!content.length) throw new Error('content is required');
    const speaker = msg.speaker || 'none';
    return {
      content,
      language: msg.language || 'ja',
      pronunciation: msg.pronunciation || '',
      speaker,
      speaker_type: speaker,
    };
  };

  const normalized = messages.map(normalizeMessage);
  const now = Date.now();
  const postId = nextId();

  const post = {
    id: postId,
    texts: [normalized[0]],
    tags: extractTags([normalized[0]]),
    createdAt: now,
    updatedAt: now,
    imageId: null,
    imageRemoved: false,
    isDeleted: false,
    pinned: false,
    pinnedAt: null,
    sourceUrl: null,
    linkedPuzzleIds: [],
  };
  state.data.posts.push(post);

  normalized.slice(1).forEach((text, index) => {
    const timestamp = now + index + 1;
    const reply = {
      id: nextId(),
      postId,
      texts: [text],
      tags: extractTags([text]),
      createdAt: timestamp,
      updatedAt: timestamp,
      imageId: null,
      isDeleted: false,
    };
    state.data.replies.push(reply);
  });

  ensureSpeakerFields(state.data);
  persistData();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lang-sns-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importFromJsonString(reader.result);
    } catch (e) {
      alert('JSONの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

function setupTabs() {
  const tabButtons = document.querySelectorAll('.tabs button[data-tab]');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTab = btn.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === state.currentTab);
      });
      if (state.currentTab === 'dashboard') {
        renderDashboard();
      }
    });
  });
}

function setupGlobalEvents() {
  ['new-post-btn', 'fab-new-post', 'fab-new-puzzle'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => {
      if (id === 'fab-new-puzzle') {
        openModal(buildPuzzleForm({ mode: 'create' }), '謎カードを作成');
      } else {
        openModal(buildPostForm({ mode: 'create' }), '新規投稿');
      }
    });
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('image-close').addEventListener('click', closeImageViewer);
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.getElementById('image-viewer').addEventListener('click', (e) => { if (e.target.id === 'image-viewer') closeImageViewer(); });
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', (e) => {
    importData(e.target.files[0]);
    e.target.value = '';
  });
  const importTextBtn = document.getElementById('import-text-btn');
  if (importTextBtn) {
    importTextBtn.addEventListener('click', () => {
      const textarea = document.getElementById('import-textarea');
      const text = textarea?.value.trim();
      if (!text) {
        alert('JSONを入力してください');
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          importConversationMessages(parsed);
        } else {
          mergeImportedData(parsed);
        }
        if (textarea) textarea.value = '';
      } catch (err) {
        alert('JSONの読み込みに失敗しました');
      }
    });
  }
  document.getElementById('search-btn').addEventListener('click', runSearch);
  const likeFilterBtn = document.getElementById('search-pin-btn');
  if (likeFilterBtn) likeFilterBtn.addEventListener('click', () => { toggleSearchPinnedFilter(); runSearch(); });
  document.getElementById('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => {
      console.error('Service worker registration failed', err);
    });
  }
}

function init() {
  loadData();
  setupTabs();
  setupGlobalEvents();
  registerServiceWorker();
  render();
}

document.addEventListener('DOMContentLoaded', init);
