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

function generateStableId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

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
  ensureReplyFields(state.data);
  ensurePostFields(state.data);
  ensurePuzzleFields(state.data);
}

function findPuzzleByIdentifier(identifier) {
  if (!identifier) return null;
  return state.data.puzzles.find((puzzle) => puzzle.id === identifier || puzzle.refId === identifier) || null;
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

function ensureRefIds(items = [], prefix) {
  items.forEach((item) => {
    if (!item.refId) item.refId = generateStableId(prefix);
  });
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
  ensureRefIds(data?.posts, 'post');
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

function ensureReplyFields(data) {
  ensureRefIds(data?.replies, 'reply');
}

function ensurePuzzleFields(data) {
  ensureRefIds(data?.puzzles, 'puzzle');
  const defaultReview = () => ({ intervalIndex: 0, nextReviewDate: null, history: [] });
  (data?.puzzles || []).forEach((puzzle, index) => {
    puzzle.id = puzzle.id || `puzzle_${index + 1}`;
    puzzle.text = puzzle.text || '';
    puzzle.language = puzzle.language || 'ja';
    puzzle.speaker = puzzle.speaker || puzzle.speaker_type || 'none';
    puzzle.speaker_type = puzzle.speaker;
    puzzle.pronunciation = puzzle.pronunciation || '';
    puzzle.post = Array.isArray(puzzle.post)
      ? puzzle.post.map((ref) => {
        const normalized = normalizePostRef(ref);
        return normalized || { postId: '', refId: '', textIndex: 0 };
      })
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
  const tagLabel = document.createElement('label');
  tagLabel.className = 'tag-label';
  tagLabel.textContent = 'タグ';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = '#タグ をスペースまたはカンマ区切りで入力';
  tagInput.className = 'tag-input';
  if (targetPost?.tags?.length) {
    tagInput.value = targetPost.tags.map((t) => `#${t}`).join(' ');
  }
  tagSection.append(tagLabel, tagInput);
  const textAreaContainer = document.createElement('div');
  textAreaContainer.id = 'text-block-container';
  textAreaContainer.classList.add('text-block-container');
  let addBtn;

  const sourceSection = document.createElement('div');
  sourceSection.className = 'modal-tag-section';
  const sourceLabel = document.createElement('label');
  sourceLabel.className = 'tag-label';
  sourceLabel.textContent = '参考URL';
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
  puzzleLabel.textContent = '紐づく謎';
  const puzzleInput = document.createElement('input');
  puzzleInput.type = 'text';
  puzzleInput.placeholder = 'puzzle-xxxx';
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
        refId: generateStableId('reply'),
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
        targetPost.linkedPuzzleIds = parsePuzzleIdentifiers(puzzleInput.value);
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
        refId: generateStableId('post'),
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
        linkedPuzzleIds: parsePuzzleIdentifiers(puzzleInput.value),
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
  fragment.appendChild(tagSection);
  if (!isReplyContext) {
    fragment.appendChild(sourceSection);
    fragment.appendChild(puzzleSection);
  }
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

function parsePuzzleIdentifiers(value) {
  return Array.from(new Set(
    value
      .split(/[\s,、]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter((id) => id.length > 0),
  ));
}

function findPostByIdentifiers({ postId, refId } = {}) {
  if (refId) {
    const byRef = state.data.posts.find((p) => p.refId === refId);
    if (byRef) return byRef;
  }

  const numericId = Number(postId);
  if (Number.isFinite(numericId)) {
    return state.data.posts.find((p) => p.id === numericId) || null;
  }
  return null;
}

function findReplyByIdentifiers({ replyId, replyRefId } = {}) {
  if (replyRefId) {
    const byRef = state.data.replies.find((r) => r.refId === replyRefId);
    if (byRef) return byRef;
  }

  const numericId = Number(replyId);
  if (Number.isFinite(numericId)) {
    return state.data.replies.find((r) => r.id === numericId) || null;
  }
  return null;
}

function normalizePostRef(ref) {
  if (!ref) return null;
  const textIndex = Number(ref.textIndex ?? 0);
  const safeIndex = Number.isFinite(textIndex) ? textIndex : 0;
  const reply = findReplyByIdentifiers(ref);
  const post = findPostByIdentifiers({ postId: ref.postId ?? reply?.postId, refId: ref.refId });
  const postId = post?.id
    ?? (Number.isFinite(Number(ref.postId)) ? Number(ref.postId) : null)
    ?? (Number.isFinite(Number(reply?.postId)) ? Number(reply?.postId) : null);
  const refId = ref.refId || reply?.refId || post?.refId || null;
  const replyId = reply?.id ?? (Number.isFinite(Number(ref.replyId)) ? Number(ref.replyId) : null);

  if (!refId && !Number.isFinite(postId)) return null;

  return { postId, refId, replyId, textIndex: safeIndex };
}

function formatPostRef(ref) {
  const normalized = normalizePostRef(ref);
  if (!normalized) return '';
  const base = normalized.refId || (Number.isFinite(normalized.postId) ? `post${normalized.postId}` : '');
  if (!base) return '';
  const textIndex = Number.isFinite(normalized.textIndex) ? normalized.textIndex : 0;
  return `${base}.${textIndex}`;
}

function parsePostRefInput(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/([\w-]+)\s*\.\s*(\d+)/i);
  if (!match) return null;

  const base = match[1];
  const textIndex = Number(match[2]);
  if (!Number.isFinite(textIndex)) return null;

  const baseWithoutPrefix = base.replace(/^post/i, '');
  const post = findPostByIdentifiers({ refId: base, postId: baseWithoutPrefix });
  const reply = findReplyByIdentifiers({ replyRefId: base, replyId: baseWithoutPrefix });
  const postId = post?.id
    ?? reply?.postId
    ?? (Number.isFinite(Number(baseWithoutPrefix)) ? Number(baseWithoutPrefix) : null);
  const refId = post?.refId || reply?.refId || (post ? post.refId : null) || (postId === null ? base : null);
  const replyId = reply?.id ?? null;

  return normalizePostRef({ postId, refId, textIndex, replyId });
}

function focusElementWithHighlight(elementId) {
  if (!elementId) return false;
  const element = document.getElementById(elementId);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.add('focus-highlight');
  setTimeout(() => element.classList.remove('focus-highlight'), 1600);
  return true;
}

function updateTabButtonIcon(button, isActive) {
  const icon = button.querySelector('.tab-icon');
  if (!icon) return;
  const nextSrc = isActive ? button.dataset.iconOn : button.dataset.iconOff;
  if (nextSrc) icon.src = nextSrc;
}

function activateTab(tabName) {
  const tabButtons = document.querySelectorAll('.tabs button[data-tab]');
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    updateTabButtonIcon(btn, isActive);
  });
  state.currentTab = tabName;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === state.currentTab);
  });
  if (state.currentTab === 'dashboard') {
    renderDashboard();
  }
}

function navigateToPost(postRef, textIndex = null) {
  activateTab('timeline');
  renderTimeline({ forceRenderAll: true });
  const normalized = normalizePostRef(
    typeof postRef === 'object' && postRef !== null
      ? { ...postRef, textIndex: postRef.textIndex ?? textIndex }
      : { postId: postRef, textIndex },
  );
  const targetPost = normalized ? findPostByIdentifiers(normalized) : null;
  const targetPostId = targetPost?.id ?? normalized?.postId;
  requestAnimationFrame(() => {
    const targetTextId = Number.isFinite(Number(normalized?.textIndex)) && targetPostId !== null
      ? `post-text-${targetPostId}-${normalized.textIndex}`
      : null;
    const found = (targetTextId && focusElementWithHighlight(targetTextId))
      || (targetPostId !== null && focusElementWithHighlight(`post-card-${targetPostId}`));
    if (!found) console.warn('ターゲットのポストが見つかりませんでした', postRef, textIndex);
  });
}

function navigateToReply(postId, replyId) {
  activateTab('timeline');
  renderTimeline({ forceRenderAll: true });
  requestAnimationFrame(() => {
    const found = focusElementWithHighlight(`reply-card-${replyId}`) || focusElementWithHighlight(`post-card-${postId}`);
    if (!found) console.warn('ターゲットのリプライが見つかりませんでした', postId, replyId);
  });
}

function navigateToPuzzle(puzzleId) {
  activateTab('puzzles');
  renderPuzzles();
  requestAnimationFrame(() => {
    const puzzle = findPuzzleByIdentifier(puzzleId);
    const targetId = puzzle?.id || puzzleId;
    if (!focusElementWithHighlight(`puzzle-card-${targetId}`)) {
      console.warn('ターゲットの謎カードが見つかりませんでした', puzzleId);
    }
  });
}

function buildPuzzleForm({ mode = 'create', targetPuzzle = null } = {}) {
  const fragment = document.createDocumentFragment();
  const container = document.createElement('div');
  container.className = 'modal-body-section puzzle-form';

  const base = targetPuzzle || {
    id: '',
    text: '',
    language: 'ja',
    speaker: 'none',
    pronunciation: '',
    post: [{ postId: '', refId: '', textIndex: 0 }],
    relatedPuzzleIds: [],
    notes: [{ id: `note_${Date.now()}`, text: '', createdAt: Date.now() }],
    isSolved: false,
    solvedAt: null,
    meaning: '',
    alternatives: [''],
    examples: [''],
    tags: [],
  };

  const updateRemoveButtons = (listEl) => {
    const buttons = Array.from(listEl.querySelectorAll('.remove-text-btn'));
    const shouldDisable = buttons.length <= 1;
    buttons.forEach((btn) => {
      btn.disabled = shouldDisable;
    });
  };

  const textContainer = document.createElement('div');
  textContainer.id = 'puzzle-text-block-container';
  textContainer.className = 'text-block-container';
  const textBlock = createTextBlockInput(
    base.text,
    base.language,
    base.pronunciation,
    base.speaker || base.speaker_type || 'none',
    false,
  );
  textContainer.appendChild(textBlock);

  const tagsSection = document.createElement('div');
  tagsSection.className = 'form-row';
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'tag-label';
  tagsLabel.textContent = 'タグ';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'tag-input';
  tagsInput.placeholder = '#タグ をスペースまたはカンマ区切りで入力';
  tagsInput.value = (base.tags || []).map((t) => `#${t}`).join(' ');
  tagsSection.append(tagsLabel, tagsInput);

  const postContainer = document.createElement('div');
  postContainer.className = 'puzzle-multi-list';
  const postLabel = document.createElement('div');
  postLabel.className = 'tag-label';
  postLabel.textContent = '手がかり';
  const postList = document.createElement('div');
  postList.className = 'puzzle-field-list';
  const addPostBtn = document.createElement('button');
  addPostBtn.type = 'button';
  addPostBtn.className = 'add-text-button';
  addPostBtn.textContent = '＋';

  const refreshPostRemoveState = () => updateRemoveButtons(postList);

  const createPostRow = (ref = { postId: '', refId: '', textIndex: 0 }) => {
    const row = document.createElement('div');
    row.className = 'puzzle-ref-row';
    const postInput = document.createElement('input');
    postInput.type = 'text';
    postInput.placeholder = 'post-xxxx.0';
    postInput.className = 'tag-input';
    postInput.value = formatPostRef(ref);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-text-btn';
    remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
    remove.addEventListener('click', () => {
      if (postList.children.length > 1) {
        row.remove();
        refreshPostRemoveState();
      }
    });
    row.append(postInput, remove);
    return row;
  };

  (base.post.length ? base.post : [{ postId: '', textIndex: 0 }]).forEach((ref) => postList.appendChild(createPostRow(ref)));
  refreshPostRemoveState();
  addPostBtn.addEventListener('click', () => {
    postList.appendChild(createPostRow());
    refreshPostRemoveState();
  });
  postContainer.append(postLabel, postList, addPostBtn);

  const relatedRow = document.createElement('div');
  relatedRow.className = 'form-row';
  const relatedLabel = document.createElement('label');
  relatedLabel.className = 'tag-label';
  relatedLabel.textContent = '関連する謎';
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
  notesLabel.textContent = 'メモ';
  const notesList = document.createElement('div');
  notesList.className = 'puzzle-field-list';
  const addNoteBtn = document.createElement('button');
  addNoteBtn.type = 'button';
  addNoteBtn.className = 'add-text-button';
  addNoteBtn.textContent = '＋';

  const refreshNoteRemoveState = () => updateRemoveButtons(notesList);

  const createNoteArea = (note) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'puzzle-note-row';
    const textarea = document.createElement('textarea');
    textarea.className = 'text-area';
    textarea.value = note?.text || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-text-btn';
    remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
    remove.addEventListener('click', () => {
      if (notesList.children.length > 1) {
        wrapper.remove();
        refreshNoteRemoveState();
      }
    });
    wrapper.append(textarea, remove);
    return wrapper;
  };
  (base.notes.length ? base.notes : [{}]).forEach((note) => notesList.appendChild(createNoteArea(note)));
  refreshNoteRemoveState();
  addNoteBtn.addEventListener('click', () => {
    notesList.appendChild(createNoteArea({ text: '' }));
    refreshNoteRemoveState();
  });
  notesContainer.append(notesLabel, notesList, addNoteBtn);

  const secondaryTextContainer = document.createElement('div');
  secondaryTextContainer.id = 'puzzle-text-block-container';
  secondaryTextContainer.className = 'text-block-container';
  const secondaryTextBlock = createTextBlockInput('', 'ja', '', 'none', false);
  secondaryTextContainer.append(secondaryTextBlock);

  const clueSection = document.createElement('div');
  clueSection.className = 'puzzle-form-section active';
  clueSection.append(notesContainer, tagsSection, postContainer, relatedRow);

  const meaningRow = document.createElement('div');
  meaningRow.className = 'form-row';
  const meaningLabel = document.createElement('label');
  meaningLabel.className = 'tag-label';
  meaningLabel.textContent = '意味';
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

    const refreshListState = () => updateRemoveButtons(list);

    const createArea = (value = '') => {
      const row = document.createElement('div');
      row.className = 'puzzle-note-row';
      const area = document.createElement('textarea');
      area.className = 'text-area';
      area.value = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-text-btn';
      remove.innerHTML = '<img src="img/delete.svg" alt="削除" width="25" class="icon-inline">';
      remove.addEventListener('click', () => {
        if (list.children.length > 1) {
          row.remove();
          refreshListState();
        }
      });
      row.append(area, remove);
      return row;
    };

    (values.length ? values : ['']).forEach((val) => list.appendChild(createArea(val)));
    refreshListState();
    addBtn.addEventListener('click', () => {
      list.appendChild(createArea(''));
      refreshListState();
    });
    wrap.append(label, list, addBtn);
    return wrap;
  };

  const alternativesWrap = createTextList('言い換え', base.alternatives?.length ? base.alternatives : ['']);
  const examplesWrap = createTextList('例文', base.examples?.length ? base.examples : ['']);

  const tagsRow = document.createElement('div');
  const solutionSection = document.createElement('div');
  solutionSection.className = `puzzle-form-section${base.isSolved ? ' active' : ''}`;
  solutionSection.append(meaningRow, alternativesWrap, examplesWrap);

  if (!base.isSolved) {
    secondaryTextContainer.classList.add('hidden');
  }

  container.append(textContainer, clueSection, solutionSection, secondaryTextContainer);
  fragment.append(container);

  const actions = document.createElement('div');
  actions.className = 'modal-actions puzzle-modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-action-button';
  cancelBtn.innerHTML = '<img src="img/delete.svg" alt="キャンセル" width="25" class="icon-inline">';
  cancelBtn.addEventListener('click', closeModal);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'modal-primary-button primary-button modal-action-button';
  submitBtn.textContent = mode === 'edit' ? 'Save' : 'Create';

  submitBtn.addEventListener('click', () => {
    const textWrapper = textContainer.querySelector('.text-area-wrapper');
    const textArea = textWrapper?.querySelector('textarea');
    const langSelect = textWrapper?.querySelector('.language-select-input');
    const pronunciationInput = textWrapper?.querySelector('.pronunciation-input');
    const speakerValue = textWrapper?.querySelector('.speaker-select-value')?.value || 'none';

    const trimmedText = textArea?.value.trim() || '';
    if (!trimmedText.length) {
      alert('テキストを入力してください');
      return;
    }
    const now = Date.now();
    const tagValues = parseTagInput(tagsInput.value);

    const postRefs = Array.from(postList.children)
      .map((row) => parsePostRefInput(row.querySelector('input[type="text"]')?.value || ''))
      .filter(Boolean);

    const noteTexts = Array.from(notesList.children).map((row, idx) => {
      const text = row.querySelector('textarea')?.value.trim() || '';
      return {
        id: base.notes[idx]?.id || `note_${Date.now()}_${idx}`,
        text,
        createdAt: base.notes[idx]?.createdAt || now,
      };
    }).filter((note) => note.text.length > 0);

    const relatedIds = Array.from(new Set(parseTagInput(relatedInput.value)));
    const collectList = (wrap) => Array.from(wrap.querySelectorAll('textarea')).map((el) => el.value.trim()).filter((v) => v.length);
    const alternatives = collectList(alternativesWrap);
    const examples = collectList(examplesWrap);
    const meaning = meaningArea.value.trim();
    const solvedActive = base.isSolved;

    if (mode === 'edit' && targetPuzzle) {
      targetPuzzle.text = trimmedText;
      targetPuzzle.language = langSelect.value;
      targetPuzzle.speaker = speakerValue;
      targetPuzzle.speaker_type = speakerValue;
      targetPuzzle.pronunciation = pronunciationInput.value.trim();
      targetPuzzle.post = postRefs;
      targetPuzzle.relatedPuzzleIds = relatedIds;
      targetPuzzle.notes = noteTexts;
      targetPuzzle.meaning = meaning;
      targetPuzzle.alternatives = alternatives;
      targetPuzzle.examples = examples;
      targetPuzzle.tags = tagValues;
      targetPuzzle.isSolved = solvedActive;
      targetPuzzle.solvedAt = solvedActive ? targetPuzzle.solvedAt || now : null;
      targetPuzzle.updatedAt = now;
    } else {
      const puzzle = {
        id: `puzzle_${nextId()}`,
        refId: generateStableId('puzzle'),
        text: trimmedText,
        language: langSelect.value,
        speaker: speakerValue,
        speaker_type: speakerValue,
        pronunciation: pronunciationInput.value.trim(),
        post: postRefs,
        relatedPuzzleIds: relatedIds,
        notes: noteTexts,
        isSolved: solvedActive,
        solvedAt: solvedActive ? now : null,
        meaning,
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

  actions.append(cancelBtn, submitBtn);
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


function renderCardList(container, items, {
  emptyMessage,
  highlightImage = false,
  forceRenderAll = false,
  renderer = (item, options) => renderPostCard(item, options),
} = {}) {
  if (container._infiniteObserver) {
    container._infiniteObserver.disconnect();
  }
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const initialCount = forceRenderAll ? items.length : 50;
  const batchSize = forceRenderAll ? items.length : 20;
  let index = 0;
  let observer = null;

  const addSentinel = () => {
    if (forceRenderAll) return;
    const sentinel = document.createElement('div');
    sentinel.className = 'load-sentinel';
    container.appendChild(sentinel);
    if (observer) observer.observe(sentinel);
  };

  const renderBatch = (count) => {
    const slice = items.slice(index, index + count);
    slice.forEach((item) => container.appendChild(renderer(item, { highlightImage })));
    index += count;
    if (index < items.length) addSentinel();
  };

  observer = forceRenderAll
    ? null
    : new IntersectionObserver((entries) => {
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

function renderTimeline(options = {}) {
  const { forceRenderAll = false } = options;
  const container = document.getElementById('timeline-list');
  const sorted = [...state.data.posts].sort((a, b) => b.createdAt - a.createdAt);
  renderCardList(container, sorted, { emptyMessage: '投稿がありません。', forceRenderAll });
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
  card.id = `puzzle-card-${puzzle.id}`;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const created = document.createElement('span');
  created.className = 'card-meta-item';
  created.textContent = formatDate(puzzle.updatedAt || puzzle.createdAt);

  const body = document.createElement('div');
  body.className = 'card-body puzzle-body';

  const textGroup = document.createElement('div');
  textGroup.className = 'text-block-group';
  textGroup.id = `puzzle-text-${puzzle.id}`;
  const speakerBadge = createSpeakerBadge(puzzle.speaker_type || puzzle.speaker || 'none');
  textGroup.appendChild(speakerBadge);

  const textBlock = document.createElement('div');
  textBlock.className = 'text-block';

  const label = document.createElement('div');
  label.className = 'text-label';
  const langLabel = getLanguageLabel(puzzle.language);
  const option = langOptions.find((opt) => opt.value === puzzle.language);
  if (option?.speakable) {
    const speakBtn = document.createElement('button');
    speakBtn.type = 'button';
    speakBtn.className = 'text-action-button text-label-button';
    speakBtn.innerHTML = `<img src="img/vol.svg" alt="" width="16" class="icon-inline"> ${langLabel}`;
    speakBtn.addEventListener('click', () => playSpeech(puzzle.text, puzzle.language));
    label.append(speakBtn);
  } else {
    const langText = document.createElement('span');
    langText.textContent = langLabel;
    label.append(langText);
  }

  const content = document.createElement('div');
  content.className = 'text-content';
  content.textContent = puzzle.text;

  textBlock.append(label, content);
  if (puzzle.pronunciation) {
    const pron = document.createElement('div');
    pron.className = 'pronunciation';
    pron.textContent = puzzle.pronunciation;
    textBlock.appendChild(pron);
  }

  const referenceRow = document.createElement('div');
  referenceRow.className = 'post-ref-row timeline-ref-row';
  const refValue = puzzle.refId || puzzle.id;
  const refText = document.createElement('span');
  refText.className = 'post-ref-text';
  refText.textContent = refValue;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'copy-ref-button';
  copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(refValue);
      copyBtn.innerHTML = '<img src="img/copy_on.svg" alt="" width="24" class="icon-inline">';
      setTimeout(() => { copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">'; }, 1500);
    } catch (error) {
      alert('コピーに失敗しました');
    }
  });

  referenceRow.append(refText, copyBtn);
  textBlock.appendChild(referenceRow);
  textGroup.appendChild(textBlock);
  body.appendChild(textGroup);

  const clueContent = document.createElement('div');
  clueContent.className = 'puzzle-section-content';
  const extra = document.createElement('div');
  extra.className = 'post-extra';

  const hasNotes = puzzle.notes?.length;
  if (hasNotes) {
    const notesWrap = document.createElement('div');
    notesWrap.className = 'puzzle-note-list';
    puzzle.notes.forEach((note) => {
      const noteEl = document.createElement('div');
      noteEl.className = 'puzzle-note';
      noteEl.textContent = note.text;
      notesWrap.appendChild(noteEl);
    });
    extra.appendChild(notesWrap);
  }

  if (puzzle.tags?.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'post-extra-row';
    const tagLabel = document.createElement('span');
    tagLabel.className = 'post-extra-label';
    tagLabel.innerHTML = '<img src="img/tag.svg" alt="" width="20" class="icon-inline">';
    const tagList = renderPuzzleTagList(puzzle.tags);
    tagRow.append(tagLabel, tagList);
    extra.appendChild(tagRow);
  }

  const hasPostRefs = puzzle.post?.length;
  if (hasPostRefs) {
    const clueRow = document.createElement('div');
    clueRow.className = 'post-extra-row puzzle-clue-row';
    const clueLabel = document.createElement('span');
    clueLabel.className = 'post-extra-label';
    clueLabel.innerHTML = '<img src="img/link.svg" alt="" width="20" class="icon-inline">';

    const clueWrap = document.createElement('div');
    clueWrap.className = 'puzzle-clue-list';

    const list = document.createElement('div');
    list.className = 'puzzle-ref-list';
    puzzle.post.forEach((ref) => {
      const normalized = normalizePostRef(ref);
      const label = formatPostRef(normalized) || `Post #${ref.postId} / textIndex ${ref.textIndex}`;
      if (normalized) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'puzzle-ref-link';
        link.textContent = label;
        link.addEventListener('click', () => navigateToPost(normalized));
        list.appendChild(link);
      } else {
        const text = document.createElement('span');
        text.textContent = label;
        list.appendChild(text);
      }
    });
    clueWrap.appendChild(list);

    clueRow.append(clueLabel, clueWrap);
    extra.appendChild(clueRow);
  }

  if (puzzle.relatedPuzzleIds?.length) {
    const relatedRow = document.createElement('div');
    relatedRow.className = 'post-extra-row';
    const relatedLabel = document.createElement('span');
    relatedLabel.className = 'post-extra-label';
    relatedLabel.innerHTML = '<img src="img/puzzle_off.svg" alt="" width="20" class="icon-inline">';
    const relatedList = document.createElement('div');
    relatedList.className = 'puzzle-chip-list';
    puzzle.relatedPuzzleIds.forEach((id) => {
      const puzzle = findPuzzleByIdentifier(id);
      const displayId = puzzle?.refId || puzzle?.id || id;
      const targetId = puzzle?.id || id;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'puzzle-chip puzzle-chip-link';
      chip.textContent = `#${displayId}`;
      chip.addEventListener('click', () => navigateToPuzzle(targetId));
      relatedList.appendChild(chip);
    });
    relatedRow.append(relatedLabel, relatedList);
    extra.appendChild(relatedRow);
  }

  if (!extra.children.length) {
    const helper = document.createElement('div');
    helper.className = 'helper';
    helper.textContent = '手がかりがまだ登録されていません。';
    clueContent.appendChild(helper);
  } else {
    clueContent.appendChild(extra);
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
      list.className = 'puzzle-solved-list';
      values.forEach((val) => {
        const item = document.createElement('li');
        item.className = 'puzzle-solved-item';
        item.textContent = val;
        list.appendChild(item);
      });
      wrap.append(label, list);
      solvedContent.appendChild(wrap);
    };
    renderList('言い換え', puzzle.alternatives || []);
    renderList('例文', puzzle.examples || []);

    body.appendChild(createAccordion('解決', solvedContent));
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-action-button danger-action-button';
  deleteBtn.innerHTML = '<img src="img/delete.svg" alt="削除" width="20" class="icon-inline">';
  deleteBtn.addEventListener('click', () => deletePuzzle(puzzle.id));

  const solvedBtn = document.createElement('button');
  solvedBtn.className = 'card-action-button';
  solvedBtn.innerHTML = puzzle.isSolved ? '<img src="img/light_on.svg" alt="未解決に戻す" width="22" class="icon-inline">' : '<img src="img/light_off.svg" alt="解決" width="22" class="icon-inline">';
  solvedBtn.addEventListener('click', () => togglePuzzleSolved(puzzle.id));

  const editBtn = document.createElement('button');
  editBtn.className = 'card-action-button';
  editBtn.innerHTML = '<img src="img/edit.svg" alt="編集" width="20" class="icon-inline">';
  editBtn.addEventListener('click', () => openModal(buildPuzzleForm({ mode: 'edit', targetPuzzle: puzzle }), '謎カードを編集'));

  const pinBtn = document.createElement('button');
  pinBtn.className = 'card-action-button';
  pinBtn.innerHTML = puzzle.pinned
    ? '<img src="img/pin_on.svg" alt="ピン留め中" width="20" class="icon-inline">'
    : '<img src="img/pin_off.svg" alt="ピン留め" width="20" class="icon-inline">';
  if (puzzle.pinned) pinBtn.classList.add('liked');
  pinBtn.addEventListener('click', () => togglePuzzlePinned(puzzle.id));

  actions.append(deleteBtn, solvedBtn, editBtn, pinBtn);

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
  node.id = `post-card-${post.id}`;
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
    post.texts.forEach((t, textIndex) => {
      const blockGroup = document.createElement('div');
      blockGroup.className = 'text-block-group';
      blockGroup.id = `post-text-${post.id}-${textIndex}`;
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

      const referenceRow = document.createElement('div');
      referenceRow.className = 'post-ref-row timeline-ref-row';
      const refValue = formatPostRef({ postId: post.id, refId: post.refId, textIndex });
      const refText = document.createElement('span');
      refText.className = 'post-ref-text';
      refText.textContent = refValue;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-ref-button';
      copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(refValue);
          const original = copyBtn.textContent;
          copyBtn.innerHTML = '<img src="img/copy_on.svg" alt="" width="24" class="icon-inline">';
          setTimeout(() => { copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">'; }, 1500);
        } catch (error) {
          alert('コピーに失敗しました');
        }
      });

      referenceRow.append(refText, copyBtn);
      block.appendChild(referenceRow);
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

  const extra = document.createElement('div');
  extra.className = 'post-extra';

  if (post.tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'post-extra-row';
    const tagLabel = document.createElement('span');
    tagLabel.className = 'post-extra-label';
    tagLabel.innerHTML = '<img src="img/tag.svg" alt="" width="20" class="icon-inline">';
    tagRow.append(tagLabel, tagsEl);
    extra.appendChild(tagRow);
  }

  if (!post.isDeleted) {
    if (post.sourceUrl) {
      const sourceRow = document.createElement('div');
      sourceRow.className = 'post-extra-row';
      sourceRow.innerHTML = '<img src="img/link.svg" alt="" width="20" class="icon-inline">';
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
      label.innerHTML = '<img src="img/puzzle_off.svg" alt="" width="20" class="icon-inline">';
      puzzleRow.appendChild(label);
      const list = document.createElement('div');
      list.className = 'puzzle-chip-list';
      post.linkedPuzzleIds.forEach((identifier) => {
        const puzzle = findPuzzleByIdentifier(identifier);
        const displayId = puzzle?.refId || puzzle?.id || identifier;
        const targetId = puzzle?.id || identifier;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'puzzle-chip puzzle-chip-link';
        chip.textContent = `#${displayId}`;
        chip.addEventListener('click', () => navigateToPuzzle(targetId));
        list.appendChild(chip);
      });
      puzzleRow.appendChild(list);
      extra.appendChild(puzzleRow);
    }
  }

  if (extra.childElementCount) {
    body.appendChild(extra);
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
      ? '<img src="img/pin_on.svg" alt="ピン留め中" width="20" class="icon-inline">'
      : '<img src="img/pin_off.svg" alt="ピン留め" width="20" class="icon-inline">';
    if (post.pinned) pinBtn.classList.add('liked');
    pinBtn.addEventListener('click', () => togglePinned(post.id));

    actions.append(delBtn, editBtn, replyBtn, pinBtn);
  }

  const rels = state.data.replies
    .filter((r) => r.postId === post.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  let replyTextOffset = post.texts.length;
  repliesWrap.innerHTML = '';
  rels.forEach((reply) => {
    const card = document.createElement('div');
    card.className = 'reply-card';
    card.id = `reply-card-${reply.id}`;
    const metaRow = document.createElement('div');
    metaRow.className = 'card-meta';
    const metaText = document.createElement('span');
    metaText.className = 'card-meta-item';
    metaText.textContent = formatDate(reply.createdAt);
    metaRow.appendChild(metaText);
    const bodyRow = document.createElement('div');
    bodyRow.className = 'card-body';
    reply.texts.forEach((t, textIndex) => {
      const refIndex = replyTextOffset + textIndex;
      const blockGroup = document.createElement('div');
      blockGroup.className = 'text-block-group';
      blockGroup.id = `post-text-${post.id}-${refIndex}`;
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

      const referenceRow = document.createElement('div');
      referenceRow.className = 'post-ref-row timeline-ref-row';
      const refValue = formatPostRef({
        postId: post.id,
        refId: reply.refId || post.refId,
        replyId: reply.id,
        textIndex: refIndex,
      });
      const refText = document.createElement('span');
      refText.className = 'post-ref-text';
      refText.textContent = refValue;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-ref-button';
      copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(refValue);
          copyBtn.innerHTML = '<img src="img/copy_on.svg" alt="" width="24" class="icon-inline">';
          setTimeout(() => {
            copyBtn.innerHTML = '<img src="img/copy_off.svg" alt="" width="24" class="icon-inline">';
          }, 1500);
        } catch (error) {
          alert('コピーに失敗しました');
        }
      });

      referenceRow.append(refText, copyBtn);
      block.appendChild(referenceRow);
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

    replyTextOffset += reply.texts.length;
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

function togglePuzzlePinned(id) {
  const puzzle = state.data.puzzles.find((p) => p.id === id);
  if (!puzzle) return;
  puzzle.pinned = !puzzle.pinned;
  puzzle.pinnedAt = puzzle.pinned ? Date.now() : null;
  puzzle.updatedAt = Date.now();
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
  if (icon) icon.src = nextState ? 'img/pin_on.svg' : 'img/pin_off.svg';
}

function toggleSearchSolvedFilter() {
  const btn = document.getElementById('search-solved-btn');
  if (!btn) return;
  const nextState = !btn.classList.contains('active');
  btn.classList.toggle('active', nextState);
  btn.setAttribute('aria-pressed', nextState);
  const icon = btn.querySelector('img');
  if (icon) icon.src = nextState ? 'img/light_on.svg' : 'img/light_off.svg';
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

function isSearchSolvedFilterActive() {
  return document.getElementById('search-solved-btn')?.classList.contains('active');
}

function textMatchesAnyTerm(text, lowerTerms) {
  if (!lowerTerms.length) return true;
  const normalized = (text ?? '').toString().toLowerCase();
  return lowerTerms.some((term) => normalized.includes(term));
}

function buildExcerpt(text, terms, radius = 10) {
  if (!text) return '';
  if (!terms.length) return text;
  const original = (text ?? '').toString();
  const lower = original.toLowerCase();
  const matchedTerm = terms.find((term) => lower.includes(term));
  if (!matchedTerm) return original;
  const index = lower.indexOf(matchedTerm);
  const start = Math.max(0, index - radius);
  const end = Math.min(original.length, index + matchedTerm.length + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < original.length ? '...' : '';
  return `${prefix}${original.slice(start, end)}${suffix}`;
}

function getPostPrimaryText(post) {
  return post?.texts?.[0]?.content || '';
}

function createSearchResultCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = item.detail ? 'search-result-card two-line' : 'search-result-card';
  card.addEventListener('click', item.onClick);

  const main = document.createElement('div');
  main.className = 'search-result-main';
  main.textContent = item.main || '';
  card.appendChild(main);

  if (item.detail) {
    const detail = document.createElement('div');
    detail.className = 'search-result-detail';
    detail.textContent = item.detail;
    card.appendChild(detail);
  }

  if (item.refText) {
    const refRow = document.createElement('div');
    refRow.className = 'post-ref-row search-ref-row';

    const refText = document.createElement('span');
    refText.className = 'post-ref-text';
    refText.textContent = item.refText;

    refRow.appendChild(refText);
    card.appendChild(refRow);
  }

  return card;
}

function runSearch() {
  const query = document.getElementById('search-input').value.trim();
  const searchType = document.getElementById('search-type-select')?.value || 'all';
  const container = document.getElementById('search-results');
  const pinnedOnly = isSearchPinnedFilterActive();
  const solvedOnly = isSearchSolvedFilterActive();

  const terms = query.split(/\s+/).filter(Boolean);
  const tagFilters = [];
  const textTerms = [];
  terms.forEach((t) => {
    if (t.startsWith('#')) tagFilters.push(t.slice(1).toLowerCase());
    else textTerms.push(t.toLowerCase());
  });

  const hasTextTerms = textTerms.length > 0;
  const hasAnyQuery = hasTextTerms || tagFilters.length > 0;

  const matchesTextTerms = (fields, lowerTerms) => {
    if (!lowerTerms.length) return true;
    const normalized = (fields || []).filter(Boolean).map((text) => text.toLowerCase());
    return lowerTerms.every((term) => normalized.some((field) => field.includes(term)));
  };

  const matchesTags = (tags = []) => {
    if (!tagFilters.length) return true;
    const normalizedTags = tags.map((tag) => tag.toLowerCase());
    return tagFilters.every((tag) => normalizedTags.includes(tag));
  };

  const results = [];

  const getPostRefValue = ({ post, reply = null, textIndex = 0 } = {}) => formatPostRef({
    postId: post?.id,
    refId: reply?.refId || post?.refId,
    replyId: reply?.id,
    textIndex,
  });

  const getPuzzleRefValue = (puzzle) => puzzle?.refId || puzzle?.id || '';

  if (searchType === 'all' || searchType === 'clue') {
    state.data.posts
      .filter((p) => !p.isDeleted)
      .forEach((post) => {
        if (pinnedOnly && !post.pinned) return;
        if (!matchesTags(post.tags)) return;
        const replies = state.data.replies.filter((r) => r.postId === post.id);
        const fields = [
          ...(post.texts || []).map((t) => t.content),
          ...replies.flatMap((r) => (r.texts || []).map((t) => t.content)),
          ...(post.tags || []),
        ];
        if (!matchesTextTerms(fields, textTerms)) return;

        if (hasTextTerms) {
          (post.texts || []).forEach((t, textIndex) => {
            if (!textMatchesAnyTerm(t.content, textTerms)) return;
            results.push({
              parentType: 'post',
              parent: post,
              main: t.content,
              detail: null,
              refText: getPostRefValue({ post, textIndex }),
              onClick: () => navigateToPost(post.id, textIndex),
            });
          });

          let replyTextOffset = post.texts.length;
          replies.forEach((reply) => {
            (reply.texts || []).forEach((t, replyTextIndex) => {
              if (!textMatchesAnyTerm(t.content, textTerms)) return;
              const refIndex = replyTextOffset + replyTextIndex;
              results.push({
                parentType: 'reply',
                parent: post,
                main: t.content,
                detail: null,
                refText: getPostRefValue({ post, reply, textIndex: refIndex }),
                onClick: () => navigateToReply(post.id, reply.id),
              });
            });
            replyTextOffset += reply.texts?.length || 0;
          });
        }

        if (hasAnyQuery) {
          (post.tags || []).forEach((tag) => {
            const normalized = (tag || '').toLowerCase();
            const matchedTag = tagFilters.includes(normalized) || textTerms.some((term) => normalized.includes(term));
            if (!matchedTag) return;
            results.push({
              parentType: 'post-tag',
              parent: post,
              main: getPostPrimaryText(post) || '投稿',
              detail: `#${tag}`,
              refText: getPostRefValue({ post, textIndex: 0 }),
              onClick: () => navigateToPost(post.id),
            });
          });
        }
      });
  }

  if (searchType === 'all' || searchType === 'puzzle') {
    state.data.puzzles.forEach((puzzle) => {
      if (pinnedOnly && !puzzle.pinned) return;
      if (solvedOnly && !puzzle.isSolved) return;
      if (!matchesTags(puzzle.tags)) return;
      const fields = [
        puzzle.text,
        ...(puzzle.notes || []).map((note) => note.text),
        puzzle.meaning,
        ...(puzzle.alternatives || []),
        ...(puzzle.examples || []),
        ...(puzzle.tags || []),
      ];
      if (!matchesTextTerms(fields, textTerms)) return;

      if (hasTextTerms) {
        if (textMatchesAnyTerm(puzzle.text, textTerms)) {
          results.push({
            parentType: 'puzzle',
            parent: puzzle,
            main: puzzle.text,
            detail: null,
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        }

        (puzzle.notes || []).forEach((note) => {
          if (!textMatchesAnyTerm(note.text, textTerms)) return;
          results.push({
            parentType: 'puzzle-note',
            parent: puzzle,
            main: puzzle.text,
            detail: buildExcerpt(note.text, textTerms),
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        });

        if (textMatchesAnyTerm(puzzle.meaning, textTerms)) {
          results.push({
            parentType: 'puzzle-meaning',
            parent: puzzle,
            main: puzzle.text,
            detail: buildExcerpt(puzzle.meaning, textTerms),
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        }

        (puzzle.examples || []).forEach((exampleText) => {
          const textValue = typeof exampleText === 'string' ? exampleText : exampleText?.text;
          if (!textMatchesAnyTerm(textValue, textTerms)) return;
          results.push({
            parentType: 'puzzle-example',
            parent: puzzle,
            main: puzzle.text,
            detail: buildExcerpt(textValue, textTerms),
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        });

        (puzzle.alternatives || []).forEach((alt) => {
          const textValue = typeof alt === 'string' ? alt : alt?.text;
          if (!textMatchesAnyTerm(textValue, textTerms)) return;
          results.push({
            parentType: 'puzzle-alternative',
            parent: puzzle,
            main: puzzle.text,
            detail: buildExcerpt(textValue, textTerms),
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        });
      }

      if (hasAnyQuery) {
        (puzzle.tags || []).forEach((tag) => {
          const normalized = (tag || '').toLowerCase();
          const matchedTag = tagFilters.includes(normalized) || textTerms.some((term) => normalized.includes(term));
          if (!matchedTag) return;
          results.push({
            parentType: 'puzzle-tag',
            parent: puzzle,
            main: puzzle.text,
            detail: `#${tag}`,
            refText: getPuzzleRefValue(puzzle),
            onClick: () => navigateToPuzzle(puzzle.id),
          });
        });
      }
    });
  }

  const getItemTimestamp = (item) => (item?.parent?.updatedAt || item?.parent?.createdAt || 0);

  results.sort((a, b) => {
    const pinnedA = a.parent?.pinned ? 1 : 0;
    const pinnedB = b.parent?.pinned ? 1 : 0;
    if (pinnedA !== pinnedB) return pinnedB - pinnedA;
    return getItemTimestamp(b) - getItemTimestamp(a);
  });

  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = '<div class="empty-state">検索結果がありません。</div>';
    return;
  }

  results.forEach((item) => container.appendChild(createSearchResultCard(item)));
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

function exportJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importJsonFromFile(file, onTextImport) {
  if (!file || !onTextImport) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      onTextImport(reader.result);
    } catch (e) {
      console.error('Failed to import file JSON', e);
      alert('JSONの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

function buildImportExportModal({ description, placeholder, onFileImport, onTextImport, onExport }) {
  const container = document.createElement('div');
  container.className = 'import-export-panel';

  if (description) {
    const descriptionNode = document.createElement('p');
    descriptionNode.className = 'modal-description';
    descriptionNode.textContent = description;
    container.appendChild(descriptionNode);
  }

  const headerActions = document.createElement('div');
  headerActions.className = 'header-actions';

  const fileLabel = document.createElement('label');
  fileLabel.className = 'file-button import-button';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.className = 'file-input';
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) onFileImport?.(file);
    e.target.value = '';
  });
  fileLabel.append(fileInput, 'インポート');

  const exportButton = document.createElement('button');
  exportButton.className = 'export-button';
  exportButton.textContent = 'エクスポート';
  exportButton.addEventListener('click', () => onExport?.());

  headerActions.append(fileLabel, exportButton);

  const textareaBlock = document.createElement('div');
  textareaBlock.className = 'import-textarea-block';
  const helper = document.createElement('p');
  helper.className = 'helper';
  helper.textContent = 'JSONを貼り付けて差分インポートできます。';
  const textarea = document.createElement('textarea');
  textarea.className = 'import-textarea';
  textarea.placeholder = placeholder || 'ここにJSONを貼り付けてください';
  const importTextBtn = document.createElement('button');
  importTextBtn.className = 'import-text-btn primary-button';
  importTextBtn.textContent = 'テキストからインポート';
  importTextBtn.addEventListener('click', () => {
    const text = textarea.value.trim();
    if (!text) {
      alert('JSONを入力してください');
      return;
    }
    try {
      onTextImport?.(text);
      textarea.value = '';
    } catch (err) {
      console.error('Failed to import text JSON', err);
      alert('JSONの読み込みに失敗しました');
    }
  });

  textareaBlock.append(helper, textarea, importTextBtn);
  container.append(headerActions, textareaBlock);
  return container;
}

function getTimelineExportData() {
  return {
    version: DATA_VERSION,
    posts: state.data.posts,
    replies: state.data.replies,
    images: state.data.images,
    lastId: state.data.lastId,
  };
}

function getPuzzleExportData() {
  return {
    version: DATA_VERSION,
    puzzles: state.data.puzzles,
    lastId: state.data.lastId,
  };
}

function importTimelineJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    importConversationMessages(parsed);
    return;
  }
  mergeImportedData(parsed);
}

function importPuzzleJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    mergeImportedData({ puzzles: parsed });
    return;
  }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.puzzles)) {
      mergeImportedData({ ...parsed, puzzles: parsed.puzzles });
      return;
    }
    mergeImportedData(parsed);
    return;
  }
  throw new Error('invalid puzzle data');
}

function openTimelineDataModal() {
  const modalBody = buildImportExportModal({
    description: 'タイムラインのバックアップや他端末への移行に、JSONファイルを活用できます。',
    placeholder: '投稿データや会話データのJSONを貼り付けてください',
    onFileImport: (file) => importJsonFromFile(file, importTimelineJson),
    onTextImport: importTimelineJson,
    onExport: () => exportJson(getTimelineExportData(), 'lang-timeline.json'),
  });
  openModal(modalBody, '投稿のインポート/エクスポート');
}

function openPuzzleDataModal() {
  const modalBody = buildImportExportModal({
    description: '謎カードのデータをJSONでエクスポート・インポートできます。',
    placeholder: '謎カードのJSONを貼り付けてください',
    onFileImport: (file) => importJsonFromFile(file, importPuzzleJson),
    onTextImport: importPuzzleJson,
    onExport: () => exportJson(getPuzzleExportData(), 'lang-puzzles.json'),
  });
  openModal(modalBody, '謎カードのインポート/エクスポート');
}

function setupTabs() {
  const tabButtons = document.querySelectorAll('.tabs button[data-tab]');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
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
  const postImportFab = document.getElementById('fab-import-posts');
  if (postImportFab) postImportFab.addEventListener('click', openTimelineDataModal);
  const puzzleImportFab = document.getElementById('fab-import-puzzles');
  if (puzzleImportFab) puzzleImportFab.addEventListener('click', openPuzzleDataModal);
  document.getElementById('search-btn').addEventListener('click', runSearch);
  const likeFilterBtn = document.getElementById('search-pin-btn');
  if (likeFilterBtn) likeFilterBtn.addEventListener('click', () => { toggleSearchPinnedFilter(); runSearch(); });
  const solvedFilterBtn = document.getElementById('search-solved-btn');
  if (solvedFilterBtn) solvedFilterBtn.addEventListener('click', () => { toggleSearchSolvedFilter(); runSearch(); });
  const searchTypeSelect = document.getElementById('search-type-select');
  if (searchTypeSelect) searchTypeSelect.addEventListener('change', runSearch);
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
  activateTab(state.currentTab);
  setupGlobalEvents();
  registerServiceWorker();
  render();
}

document.addEventListener('DOMContentLoaded', init);
