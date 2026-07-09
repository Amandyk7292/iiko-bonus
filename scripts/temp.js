
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            beige: {
              50: '#fdfbf7',
              100: '#f7f4ea',
              200: '#efe6d5',
              300: '#e3d2b7',
              400: '#d3ba93',
              500: '#c5a374',
              600: '#b88c5a',
              700: '#9a714a',
              800: '#7e5d40',
              900: '#664d36',
            }
          },
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            serif: ['Playfair Display', 'serif'],
          }
        }
      }
    }
  </script>
  <style>
    :root {
      --sagi-bg: #fff7ea;
      --sagi-sidebar: #ffffff;
      --sagi-text: #2d1a12;
      --sagi-muted: #77675c;
      --sagi-border: #eadcc8;
      --sagi-green: #c66a25;
      --sagi-green-dark: #9f4d17;
      --sagi-soft: #fffaf2;
      --sagi-cream: #fffaf2;
      --sagi-cocoa: #3b2117;
      --sagi-shadow: 0 18px 48px rgba(59, 33, 23, 0.10);
    }
    * { min-width: 0; }
    html { scroll-behavior: smooth; }
    body { background-color: var(--sagi-bg); color: var(--sagi-text); letter-spacing: 0; }
    .card { background-color: rgba(255,255,255,0.96); border: 1px solid var(--sagi-border); box-shadow: var(--sagi-shadow); border-radius: 18px; }
    .input-classic { border: 1px solid #e2d2bc; background: #ffffff; padding: 0.76rem 0.9rem; border-radius: 12px; color: var(--sagi-text); transition: border-color 0.2s, box-shadow 0.2s, background 0.2s; min-height: 46px; }
    .input-classic:focus { outline: none; border-color: var(--sagi-green); box-shadow: 0 0 0 4px rgba(198, 106, 37, 0.14); background: #fffdf8; }
    .btn-classic { background-color: var(--sagi-green); color: white; transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease; border-radius: 12px; border: 1px solid var(--sagi-green); min-height: 46px; box-shadow: 0 10px 22px rgba(198, 106, 37, 0.18); }
    .btn-classic:hover { background-color: var(--sagi-green-dark); border-color: var(--sagi-green-dark); transform: translateY(-1px); }
    .btn-classic:active, .btn-outline:active { transform: translateY(0) scale(0.99); }
    .btn-outline { border: 1px solid #e2d2bc; color: var(--sagi-cocoa); background: #ffffff; transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease; border-radius: 12px; min-height: 42px; }
    .btn-outline:hover { background: #fff7ea; border-color: #d8b98f; transform: translateY(-1px); }
    .sagi-shell { display: grid; grid-template-columns: 278px minmax(0, 1fr); min-height: 100dvh; background: var(--sagi-bg); }
    .sagi-sidebar { background: var(--sagi-sidebar); border-right: 1px solid var(--sagi-border); padding: 18px 14px; overflow-y: auto; }
    .sagi-brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 18px; border-bottom: 1px solid var(--sagi-border); margin-bottom: 14px; }
    .sagi-brand-mark { width: 36px; height: 36px; border-radius: 12px; background: linear-gradient(135deg, #c66a25, #3b2117); color: white; display: grid; place-items: center; font-weight: 800; }
    .sagi-branch { padding: 10px 8px; margin-bottom: 10px; font-size: 13px; color: var(--sagi-muted); }
    .sagi-nav-title { color: #9aa1ad; font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 18px 10px 6px; }
    .sagi-nav-link { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 9px 10px; border: 0; border-radius: 12px; background: transparent; color: #3d424c; font-size: 14px; font-weight: 500; text-align: left; cursor: pointer; transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease; }
    .sagi-nav-link:hover { background: #fff3df; color: var(--sagi-cocoa); transform: translateX(2px); }
    .sagi-nav-link-active { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 9px 10px; border: 0; border-radius: 12px; background: #fde5c2; color: #74350f; font-size: 14px; font-weight: 800; text-align: left; cursor: pointer; }
    .sagi-main { min-width: 0; display: flex; flex-direction: column; }
    .sagi-topbar { min-height: 64px; background: rgba(255,255,255,0.92); backdrop-filter: blur(14px); border-bottom: 1px solid var(--sagi-border); display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 28px; position: sticky; top: 0; z-index: 30; }
    .sagi-page { padding: 28px; overflow: auto; }
    .sagi-page-title { font-size: 24px; font-weight: 700; color: #1d1f23; margin: 0; }
    .sagi-page-subtitle { font-size: 13px; color: var(--sagi-muted); margin-top: 4px; }
    .sagi-filter { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; padding: 16px; background: #fff; border: 1px solid var(--sagi-border); border-radius: 18px; box-shadow: 0 10px 28px rgba(59, 33, 23, 0.04); }
    .sagi-field label, .sagi-label { display: block; font-size: 13px; font-weight: 600; color: #555b66; margin-bottom: 6px; }
    .tab-active, .tab-inactive { border: 0; }
    .bonus-workspace { display: grid; grid-template-columns: 262px minmax(0, 1fr); gap: 32px; background: #ffffff; border: 1px solid #eef0f4; border-radius: 24px; padding: 28px; }
    .bonus-menu { display: flex; flex-direction: column; gap: 16px; }
    .bonus-nav, .bonus-nav-active { width: 100%; min-height: 53px; display: flex; align-items: center; gap: 16px; padding: 0 24px; border-radius: 6px; font-size: 16px; font-weight: 500; border: 1px solid #e7e7e6; background: transparent; color: #1d1f23; text-align: left; transition: all 0.2s; box-shadow: 0 1px 2px rgba(20, 24, 32, 0.03); }
    .bonus-nav:hover { color: #18805a; border-color: #bce7d5; }
    .bonus-nav-active { color: #1d1f23; border-color: #64c889; box-shadow: inset 0 0 0 1px #64c889, 0 1px 2px rgba(20, 24, 32, 0.03); }
    .bonus-menu-icon { width: 20px; height: 20px; opacity: 0.62; flex: 0 0 auto; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
    .bonus-nav-active .bonus-menu-icon { opacity: 0.9; color: #18805a; }
    .bonus-form-section { padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid #eef0f4; }
    .bonus-form-section label { display: block; font-size: 20px; color: #080a0d; margin-bottom: 14px; }
    .bonus-form-section label .required { color: #ef4444; }
    .bonus-save-inline { min-width: 156px; height: 45px; border-radius: 6px; background: linear-gradient(180deg, #84d79d, #63bd85); color: #ffffff; font-size: 16px; font-weight: 600; border: 0; }
    .bonus-workspace .card { border: 0; box-shadow: none; padding: 0; background: transparent; }
    .bonus-page { animation: bonusFade 180ms ease-out; }
    @keyframes bonusFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .bonus-option { display: flex; align-items: center; gap: 0.5rem; min-height: 44px; border: 1px solid var(--sagi-border); background: #ffffff; border-radius: 4px; padding: 0.75rem; font-size: 0.875rem; cursor: pointer; }
    table { min-width: 860px; }
    table th { color: #616875; font-weight: 700; font-size: 0.75rem; letter-spacing: 0; border-bottom: 1px solid var(--sagi-border); background: #fff7ea; }
    table td { border-bottom: 1px solid #eef0f4; }
    table tr:hover td { background-color: #fbfcfd; }
    #authModal, #editModal, #storyModal, #newsModal {
      align-items: flex-start;
      overflow-y: auto;
      padding: clamp(12px, 3vw, 32px);
    }
    #authModal { align-items: center; }
    #authModal > .card, #editModal > .card, #storyModal > .card, #newsModal > .card {
      width: min(100%, 34rem);
      max-height: calc(100dvh - clamp(24px, 6vw, 64px));
      overflow-y: auto;
      animation: modalIn 220ms ease-out;
    }
    #storyModal > .card, #newsModal > .card { width: min(100%, 42rem); }
    #editModal .flex.gap-3:last-child,
    #storyModal .flex.gap-3:last-child,
    #newsModal .flex.gap-3:last-child {
      position: sticky;
      bottom: -2rem;
      margin: 1.25rem -2rem -2rem;
      padding: 1rem 2rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.78), #fff);
      border-top: 1px solid var(--sagi-border);
      backdrop-filter: blur(10px);
      z-index: 5;
    }
    @keyframes modalIn { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (max-width: 920px) {
      .sagi-shell { grid-template-columns: 1fr; }
      .sagi-sidebar { position: sticky; top: 0; z-index: 40; max-height: 45dvh; border-right: 0; border-bottom: 1px solid var(--sagi-border); }
      .sagi-topbar { padding: 12px 16px; align-items: flex-start; }
      .sagi-page { padding: 16px; }
      .sagi-page-title { font-size: 20px; }
      .bonus-workspace { grid-template-columns: 1fr; padding: 18px; border-radius: 16px; }
      .sagi-filter > * { flex: 1 1 220px; }
      .sagi-filter .btn-classic, .sagi-filter .btn-outline { width: 100%; }
    }
    @media (max-width: 760px) {
      body { font-size: 15px; }
      .card { border-radius: 16px; }
      .sagi-topbar { flex-direction: column; }
      .sagi-topbar > div:last-child { width: 100%; justify-content: space-between; }
      .sagi-sidebar { max-height: 38dvh; padding: 12px; }
      .sagi-brand { padding-bottom: 12px; }
      .sagi-nav-title { margin-top: 12px; }
      #editModal > .card, #storyModal > .card, #newsModal > .card { padding: 20px; }
      #editModal .grid, #storyModal .grid, #newsModal .grid { grid-template-columns: 1fr !important; }
      #editModal .flex.gap-3:last-child,
      #storyModal .flex.gap-3:last-child,
      #newsModal .flex.gap-3:last-child {
        flex-direction: column;
        margin: 1rem -1.25rem -1.25rem;
        padding: 1rem 1.25rem;
      }
      table.responsive-table { min-width: 0; width: 100%; }
      table.responsive-table thead { display: none; }
      table.responsive-table, table.responsive-table tbody, table.responsive-table tr, table.responsive-table td { display: block; }
      table.responsive-table tr {
        margin: 0.85rem;
        border: 1px solid var(--sagi-border);
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 10px 26px rgba(59, 33, 23, 0.06);
        overflow: hidden;
      }
      table.responsive-table td {
        display: grid;
        grid-template-columns: minmax(112px, 38%) minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding: 12px 14px !important;
        border-bottom: 1px solid #f0e3d2;
        text-align: left !important;
        white-space: normal !important;
      }
      table.responsive-table td::before {
        content: attr(data-label);
        color: var(--sagi-muted);
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
      }
      table.responsive-table td:last-child { border-bottom: 0; }
      table.responsive-table td[colspan] {
        display: block;
        text-align: center !important;
      }
      table.responsive-table td[colspan]::before { content: none; }
      table.responsive-table td .text-right,
      table.responsive-table td.whitespace-nowrap { text-align: left !important; }
    }
    @media (max-width: 520px) {
      .sagi-page { padding: 12px; }
      .sagi-filter { padding: 12px; border-radius: 14px; }
      .input-classic, .btn-classic, .btn-outline { width: 100%; }
      .sagi-topbar .btn-outline { width: auto; }
      .card.p-8 { padding: 1.25rem !important; }
      .card.p-6 { padding: 1rem !important; }
      #storyModal > .card, #newsModal > .card, #editModal > .card {
        max-height: calc(100dvh - 16px);
        width: 100%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
    }
  </style>
</head>
<body class="min-h-screen font-sans">
  
  <!-- Modal Auth -->
  <div id="authModal" class="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm transition-opacity duration-300">
    <div class="card p-10 w-full max-w-sm text-center">
      <h2 class="text-3xl font-serif text-beige-800 mb-2">Управление</h2>
      <p class="text-gray-500 text-sm mb-8">Введите пароль для доступа к системе</p>
      <input type="password" id="adminPwd" placeholder="Пароль" class="input-classic w-full mb-6 text-center text-lg tracking-widest">
      <button onclick="login()" class="btn-classic w-full py-3 font-medium shadow-sm">Войти в систему</button>
      <p id="authError" class="text-red-500 mt-4 hidden text-sm">Неверный пароль</p>
    </div>
  </div>

  <!-- Modal Edit Customer -->
  <div id="editModal" class="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm hidden transition-opacity duration-300">
    <div class="card p-8 w-full max-w-md text-left relative">
      <h3 class="text-2xl font-serif text-beige-800 mb-6">Редактирование клиента</h3>
      <input type="hidden" id="edit_id">
      
      <div class="space-y-4 mb-6">
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Имя</label>
          <input type="text" id="edit_name" class="input-classic w-full">
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Телефон</label>
          <input type="text" id="edit_phone" class="input-classic w-full">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Баланс бонусов</label>
            <input type="number" id="edit_balance" class="input-classic w-full text-blue-600 font-bold">
          </div>
          <div>
            <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Общие покупки (тнг)</label>
            <input type="number" id="edit_spent" class="input-classic w-full text-gray-700 font-semibold">
          </div>
        </div>
        <div class="pt-2">
          <button type="button" onclick="grantVipStatus()" class="w-full bg-beige-100 hover:bg-beige-200 text-beige-800 text-xs py-2.5 px-3 rounded font-semibold border border-beige-300 transition-all flex items-center justify-center gap-1 shadow-sm">
            <span>Присвоить VIP статус (установить 100 000 тнг)</span>
          </button>
        </div>
      </div>

      <div class="flex gap-3">
        <button onclick="saveCustomerEdit()" id="editSaveBtn" class="btn-classic flex-1 py-3 font-medium shadow-sm">Сохранить</button>
        <button onclick="closeEditModal()" class="btn-outline px-6 py-3 font-medium">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Modal Add Story -->
  <div id="storyModal" class="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm hidden transition-opacity duration-300">
    <div class="card p-8 w-full max-w-md text-left relative">
      <input type="hidden" id="editing_story_id">
      <h3 id="storyModalTitle" class="text-2xl font-serif text-beige-800 mb-6">Создать Сториз (Инстаграм-формат)</h3>
      
      <div class="space-y-4 mb-6">
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Заголовок на обложке</label>
          <input type="text" id="story_title" placeholder="СЕЗОННЫЙ ФРАППЕ" class="input-classic w-full">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Тема / актуальное</label>
            <input type="text" id="story_group_title" placeholder="Новинки" class="input-classic w-full">
          </div>
          <div>
            <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">ID темы</label>
            <input type="text" id="story_group_id" placeholder="novinki" class="input-classic w-full">
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-2">Фото обложки (миниатюра)</label>
          <input type="hidden" id="story_cover">
          <div class="border-2 border-dashed border-beige-300 rounded-xl p-4 text-center bg-beige-50/50 hover:bg-beige-50 transition flex flex-col items-center justify-center min-h-[130px] relative overflow-hidden group">
            <img id="preview_story_cover" src="" onerror="this.classList.add('hidden'); const p = document.getElementById('placeholder_story_cover'); if(p) p.classList.remove('hidden');" class="absolute inset-0 w-full h-full object-cover hidden rounded-xl">
            <div id="placeholder_story_cover" class="flex flex-col items-center justify-center py-3 z-10 w-full">
              <p class="text-xs text-gray-500 mb-2">Фото не выбрано</p>
              <label class="btn-classic px-4 py-2 text-xs font-semibold cursor-pointer shadow-sm inline-block">
                <span>Загрузить фото</span>
                <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'story_cover')">
              </label>
            </div>
            <label id="change_btn_story_cover" class="absolute bottom-2 right-2 btn-classic px-3 py-1.5 text-xs font-semibold cursor-pointer shadow-md hidden z-10">
              <span>Заменить фото</span>
              <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'story_cover')">
            </label>
          </div>
          <p id="status_story_cover" class="text-[11px] text-green-600 mt-1 hidden font-medium">Загрузка в Supabase Storage...</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-2">Фото при открытии (на весь экран)</label>
          <input type="hidden" id="story_content">
          <div class="border-2 border-dashed border-beige-300 rounded-xl p-4 text-center bg-beige-50/50 hover:bg-beige-50 transition flex flex-col items-center justify-center min-h-[160px] relative overflow-hidden group">
            <img id="preview_story_content" src="" onerror="this.classList.add('hidden'); const p = document.getElementById('placeholder_story_content'); if(p) p.classList.remove('hidden');" class="absolute inset-0 w-full h-full object-cover hidden rounded-xl">
            <div id="placeholder_story_content" class="flex flex-col items-center justify-center py-3 z-10 w-full">
              <p class="text-xs text-gray-500 mb-2">Фото не выбрано</p>
              <label class="btn-classic px-4 py-2 text-xs font-semibold cursor-pointer shadow-sm inline-block">
                <span>Загрузить фото</span>
                <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'story_content')">
              </label>
            </div>
            <label id="change_btn_story_content" class="absolute bottom-2 right-2 btn-classic px-3 py-1.5 text-xs font-semibold cursor-pointer shadow-md hidden z-10">
              <span>Заменить фото</span>
              <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'story_content')">
            </label>
          </div>
          <p id="status_story_content" class="text-[11px] text-green-600 mt-1 hidden font-medium">Загрузка в Supabase Storage...</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Описание / Текст внутри</label>
          <textarea id="story_desc" rows="2" placeholder="Освежающий напиток со скидкой..." class="input-classic w-full"></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Длительность показа (секунд)</label>
          <input type="number" id="story_duration" value="15" class="input-classic w-full">
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Порядок внутри темы</label>
          <input type="number" id="story_sort_order" value="0" class="input-classic w-full">
        </div>
      </div>

      <div class="flex gap-3">
        <button onclick="saveStoryAdmin()" class="btn-classic flex-1 py-3 font-medium shadow-sm">Сохранить</button>
        <button onclick="closeStoryModal()" class="btn-outline px-6 py-3 font-medium">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Modal Add News -->
  <div id="newsModal" class="fixed inset-0 bg-[#333333] bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm hidden transition-opacity duration-300">
    <div class="card p-8 w-full max-w-md text-left relative">
      <input type="hidden" id="editing_news_id">
      <h3 id="newsModalTitle" class="text-2xl font-serif text-beige-800 mb-6">Создать новость</h3>

      <div class="space-y-4 mb-6">
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Заголовок</label>
          <input type="text" id="news_title" placeholder="Новинка недели" class="input-classic w-full">
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-2">Фото новости (необязательно)</label>
          <input type="hidden" id="news_image">
          <div class="border-2 border-dashed border-beige-300 rounded-xl p-4 text-center bg-beige-50/50 hover:bg-beige-50 transition flex flex-col items-center justify-center min-h-[170px] relative overflow-hidden group">
            <img id="preview_news_image" src="" onerror="this.classList.add('hidden'); const p = document.getElementById('placeholder_news_image'); if(p) p.classList.remove('hidden');" class="absolute inset-0 w-full h-full object-cover hidden rounded-xl">
            <div id="placeholder_news_image" class="flex flex-col items-center justify-center py-3 z-10 w-full">
              <p class="text-xs text-gray-500 mb-2">Фото не выбрано</p>
              <label class="btn-classic px-4 py-2 text-xs font-semibold cursor-pointer shadow-sm inline-block">
                <span>Загрузить фото</span>
                <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'news_image')">
              </label>
            </div>
            <label id="change_btn_news_image" class="absolute bottom-2 right-2 btn-classic px-3 py-1.5 text-xs font-semibold cursor-pointer shadow-md hidden z-10">
              <span>Заменить фото</span>
              <input type="file" accept="image/*" class="hidden" onchange="uploadStoryPhoto(this, 'news_image')">
            </label>
          </div>
          <p id="status_news_image" class="text-[11px] text-green-600 mt-1 hidden font-medium">Загрузка в Supabase Storage...</p>
        </div>
        <div>
          <label class="block text-xs font-semibold text-beige-800 uppercase mb-1">Описание</label>
          <textarea id="news_desc" rows="3" placeholder="Текст новости для ленты..." class="input-classic w-full"></textarea>
        </div>
      </div>

      <div class="flex gap-3">
        <button onclick="saveNewsAdmin()" class="btn-classic flex-1 py-3 font-medium shadow-sm">Сохранить</button>
        <button onclick="closeNewsModal()" class="btn-outline px-6 py-3 font-medium">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Dashboard -->
  <div id="dashboard" class="hidden sagi-shell">
    <aside class="sagi-sidebar">
      <div class="sagi-brand">
        <div class="sagi-brand-mark">B</div>
        <div>
          <div class="font-bold text-gray-900">Bulka Business</div>
          <div class="text-xs text-gray-500">Bonus admin</div>
        </div>
      </div>
      <div class="sagi-nav-title">Главное</div>
      <button onclick="switchTab('analytics')" id="tab-analytics" class="sagi-nav-link-active">Аналитика</button>
      <button onclick="switchTab('transactions')" id="tab-transactions" class="sagi-nav-link">Транзакции</button>
      <button onclick="switchTab('iiko')" id="tab-iiko" class="sagi-nav-link">iiko Front</button>
      <button onclick="switchTab('broadcast')" id="tab-broadcast" class="sagi-nav-link">WhatsApp / Рассылки</button>

      <div class="sagi-nav-title">Клиенты</div>
      <button onclick="switchTab('customers')" id="tab-customers" class="sagi-nav-link">База клиентов</button>

      <div class="sagi-nav-title">Профиль</div>
      <button onclick="switchTab('settings')" id="tab-settings" class="sagi-nav-link">Общая информация</button>
      <button onclick="switchTab('stories')" id="tab-stories" class="sagi-nav-link">Фотографии / Сториз</button>
      <button onclick="switchTab('news')" id="tab-news" class="sagi-nav-link">Новости</button>
      <button onclick="switchTab('bonus')" id="tab-bonus" class="sagi-nav-link">Бонусы</button>
      <button onclick="switchTab('locations')" id="tab-locations" class="sagi-nav-link">Локации</button>
    </aside>

    <main class="sagi-main">
      <div class="sagi-topbar">
        <div>
          <p class="sagi-page-title" id="pageTitle">Аналитика</p>
          <p class="sagi-page-subtitle" id="pageSubtitle">Обзор продаж, клиентов и бонусов</p>
        </div>
        <div class="flex items-center gap-3">
          <button class="btn-outline px-3 py-2 text-sm">RU</button>
          <button onclick="logout()" class="btn-outline px-4 py-2 text-sm">Выйти</button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="sagi-page">
      
      <!-- TAB: Analytics -->
      <div id="content-analytics" class="space-y-8">
        <div class="sagi-filter">
          <div class="sagi-field">
            <label>Период с</label>
            <input type="date" class="input-classic">
          </div>
          <div class="sagi-field">
            <label>Период до</label>
            <input type="date" class="input-classic">
          </div>
          <button onclick="fetchStats()" class="btn-classic px-5 py-2">Фильтр</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="card p-6 border-l-4 border-l-beige-500">
            <div class="flex justify-between items-start">
              <div>
                <p class="text-gray-500 text-sm font-medium mb-1">Всего клиентов</p>
                <p class="text-3xl font-serif text-beige-900" id="stat-customers">-</p>
              </div>
              <span id="stat-new-customers" class="bg-green-100 text-green-700 text-xs px-2.5 py-1 rounded-full font-semibold">+0 за 30 дн.</span>
            </div>
          </div>
          <div class="card p-6 border-l-4 border-l-green-500">
            <p class="text-gray-500 text-sm font-medium mb-1">Общий оборот (тнг)</p>
            <p class="text-3xl font-serif text-gray-800" id="stat-sales">-</p>
          </div>
          <div class="card p-6 border-l-4 border-l-purple-500">
            <p class="text-gray-500 text-sm font-medium mb-1">Оплачено бонусами (%)</p>
            <p class="text-3xl font-serif text-purple-700" id="stat-bonus-percent">-</p>
            <p class="text-xs text-gray-400 mt-1">Доля бонусов в общей выручке</p>
          </div>
          <div class="card p-6 border-l-4 border-l-blue-400">
            <div class="flex justify-between items-start">
              <div>
                <p class="text-gray-500 text-sm font-medium mb-1">Выдано бонусов</p>
                <p class="text-3xl font-serif text-gray-800" id="stat-earned">-</p>
              </div>
              <span id="stat-earned-month" class="bg-blue-50 text-blue-600 text-xs px-2.5 py-1 rounded-full font-semibold">+0 за 30 дн.</span>
            </div>
          </div>
          <div class="card p-6 border-l-4 border-l-red-400">
            <div class="flex justify-between items-start">
              <div>
                <p class="text-gray-500 text-sm font-medium mb-1">Потрачено бонусов</p>
                <p class="text-3xl font-serif text-gray-800" id="stat-burned">-</p>
              </div>
              <span id="stat-burned-month" class="bg-red-50 text-red-600 text-xs px-2.5 py-1 rounded-full font-semibold">+0 за 30 дн.</span>
            </div>
          </div>
          <div class="card p-6 border-l-4 border-l-amber-500">
            <p class="text-gray-500 text-sm font-medium mb-1">Текущие обязательства</p>
            <p class="text-3xl font-serif text-amber-700" id="stat-liabilities">-</p>
            <p class="text-xs text-gray-400 mt-1">Бонусы на руках у клиентов</p>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-6 w-full h-80 flex flex-col">
            <h4 class="text-xs font-bold text-beige-800 uppercase tracking-wider mb-4">Начисления vs Списания (всего)</h4>
            <div class="flex-1 relative flex items-center justify-center">
              <canvas id="myChart"></canvas>
            </div>
          </div>
          <div class="card p-6 w-full h-80 flex flex-col">
            <h4 class="text-xs font-bold text-beige-800 uppercase tracking-wider mb-4">Структура выручки заведения</h4>
            <div class="flex-1 relative flex items-center justify-center">
              <canvas id="chartRevenue"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB: Customers -->
      <div id="content-customers" class="hidden space-y-6">
        <div class="flex justify-end">
          <button onclick="exportCustomersCsv()" class="btn-outline px-5 py-2">Экспорт</button>
        </div>
        <div class="sagi-filter">
          <div class="sagi-field flex-1 min-w-[280px]">
            <label>Поиск</label>
            <input type="text" id="searchCustomer" onkeyup="renderCustomers()" placeholder="Поиск по имени или по номеру телефона 7077087778" class="input-classic w-full">
          </div>
          <div class="sagi-field">
            <label>Последняя покупка</label>
            <input type="date" class="input-classic">
          </div>
          <div class="sagi-field">
            <label>Дата регистрации</label>
            <input type="date" class="input-classic">
          </div>
          <label class="bonus-option min-w-[180px]"><input type="checkbox" id="multiSelectCustomers"> Выбрать несколько</label>
          <button onclick="triggerNotifyInactive()" class="btn-outline px-4 py-2 text-sm">Напомнить гостям</button>
          <button onclick="triggerExpireBonuses()" class="btn-outline px-4 py-2 text-sm text-red-600">Списать неактивные</button>
        </div>
        <div class="card overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-4">#</th>
                <th class="py-4 px-6">Имя</th>
                <th class="py-4 px-6">Телефон</th>
                <th class="py-4 px-6">Статус</th>
                <th class="py-4 px-6 text-right">Транзакции</th>
                <th class="py-4 px-6 text-right">Баланс</th>
                <th class="py-4 px-6 text-right">Общие покупки (тнг)</th>
                <th class="py-4 px-6">Статус накоплений</th>
                <th class="py-4 px-6">Рассылка</th>
                <th class="py-4 px-6 text-center">Управление</th>
              </tr>
            </thead>
            <tbody id="customersTable" class="text-sm text-gray-700">
              <tr><td colspan="10" class="py-8 px-6 text-center text-gray-400">Загрузка клиентов...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB: Transactions -->
      <div id="content-transactions" class="hidden space-y-6">
        <div class="flex gap-2 flex-wrap justify-end">
          <button onclick="alert('Форма оплаты подключается к iiko POS. Используйте кассу для проведения оплаты.')" class="btn-classic px-4 py-2">Провести оплату</button>
          <button onclick="switchTab('stories')" class="btn-outline px-4 py-2">Выдать сертификат</button>
          <button onclick="promptManualBonusByPhone()" class="btn-outline px-4 py-2">Начислить бонус</button>
        </div>
        <div class="sagi-filter">
          <div class="sagi-field">
            <label>За весь период</label>
            <input type="date" class="input-classic">
          </div>
          <div class="sagi-field">
            <label>До</label>
            <input type="date" class="input-classic">
          </div>
          <div class="sagi-field flex-1 min-w-[260px]">
            <label>Поиск</label>
            <input type="text" id="searchTransaction" onkeyup="renderTransactions()" placeholder="Поиск по номеру телефона" class="input-classic w-full">
          </div>
        </div>
        <div class="card overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-6">Дата</th>
                <th class="py-4 px-6">Номер транзакции</th>
                <th class="py-4 px-6">Клиент</th>
                <th class="py-4 px-6">Номер телефона</th>
                <th class="py-4 px-6">Метод оплаты</th>
                <th class="py-4 px-6 text-right">Сумма</th>
                <th class="py-4 px-6 text-right">Использовано</th>
                <th class="py-4 px-6 text-right">Бонус</th>
                <th class="py-4 px-6">Статус</th>
              </tr>
            </thead>
            <tbody id="transactionsTable" class="text-sm text-gray-700"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB: iiko Front -->
      <div id="content-iiko" class="hidden space-y-6">
        <div class="flex justify-end">
          <button onclick="fetchIikoOperations()" class="btn-classic px-5 py-2">Обновить</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div class="card p-5">
            <p class="text-gray-500 text-sm font-medium mb-1">Операций</p>
            <p class="text-2xl font-serif text-gray-800" id="iiko-total">0</p>
          </div>
          <div class="card p-5">
            <p class="text-gray-500 text-sm font-medium mb-1">Успешно</p>
            <p class="text-2xl font-serif text-emerald-700" id="iiko-success">0</p>
          </div>
          <div class="card p-5">
            <p class="text-gray-500 text-sm font-medium mb-1">Ошибок</p>
            <p class="text-2xl font-serif text-red-600" id="iiko-errors">0</p>
          </div>
          <div class="card p-5">
            <p class="text-gray-500 text-sm font-medium mb-1">Начислено</p>
            <p class="text-2xl font-serif text-blue-700" id="iiko-earned">0</p>
          </div>
        </div>
        <div class="sagi-filter">
          <div class="sagi-field flex-1 min-w-[260px]">
            <label>Поиск</label>
            <input type="text" id="searchIikoOperation" onkeyup="renderIikoOperations()" placeholder="Заказ, клиент, телефон, ошибка" class="input-classic w-full">
          </div>
        </div>
        <div class="card overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-6">Дата</th>
                <th class="py-4 px-6">Заказ</th>
                <th class="py-4 px-6">Клиент</th>
                <th class="py-4 px-6 text-right">Чек</th>
                <th class="py-4 px-6 text-right">Списано</th>
                <th class="py-4 px-6 text-right">Начислено</th>
                <th class="py-4 px-6">Статус</th>
                <th class="py-4 px-6">Ошибка</th>
              </tr>
            </thead>
            <tbody id="iikoOperationsTable" class="text-sm text-gray-700"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB: Broadcast -->
      <div id="content-broadcast" class="hidden space-y-6 max-w-2xl">
        <div class="card p-8">
          <h2 class="text-xl font-serif text-beige-800 mb-4">Массовая Telegram-рассылка</h2>
          <p class="text-sm text-gray-500 mb-6">Сообщение будет отправлено всем клиентам в базе, у которых есть Telegram. Скорость отправки: 10 сообщений в секунду.</p>
          
          <label class="block text-sm text-beige-800 mb-2 font-semibold">Текст сообщения</label>
          <textarea id="broadcastText" rows="6" placeholder="Внимание! Акция: 1+1 на все десерты!" class="input-classic w-full mb-4"></textarea>
          
          <button onclick="sendBroadcast()" id="btnBroadcast" class="bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-6 rounded-lg shadow-sm transition w-full">Отправить всем</button>
          <p id="broadcastMsg" class="text-center mt-4 text-sm font-medium hidden"></p>
        </div>
      </div>

      <!-- TAB: Stories -->
      <div id="content-stories" class="hidden space-y-6">
        <div class="flex justify-end mb-4">
          <button onclick="openStoryModal()" class="btn-classic px-5 py-2.5 font-medium shadow-sm flex items-center gap-2">
            <span>+ Создать Сториз</span>
          </button>
        </div>
        <div class="card overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-6">Обложка</th>
                <th class="py-4 px-6">Тема</th>
                <th class="py-4 px-6">Заголовок</th>
                <th class="py-4 px-6">Описание</th>
                <th class="py-4 px-6">Фото при открытии</th>
                <th class="py-4 px-6 text-center">Время (сек)</th>
                <th class="py-4 px-6 text-right">Действия</th>
              </tr>
            </thead>
            <tbody id="storiesTable" class="text-sm text-gray-700"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB: News -->
      <div id="content-news" class="hidden space-y-6">
        <div class="flex justify-end mb-4">
          <button onclick="openNewsModal()" class="btn-classic px-5 py-2.5 font-medium shadow-sm flex items-center gap-2">
            <span>+ Создать новость</span>
          </button>
        </div>
        <div class="card overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-6">Фото</th>
                <th class="py-4 px-6">Заголовок</th>
                <th class="py-4 px-6">Описание</th>
                <th class="py-4 px-6">Дата</th>
                <th class="py-4 px-6 text-right">Действия</th>
              </tr>
            </thead>
            <tbody id="newsTable" class="text-sm text-gray-700"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB: Locations -->
      <div id="content-locations" class="hidden space-y-6">
        <div class="flex justify-end mb-4">
          <button onclick="openLocationModal()" class="btn-classic px-5 py-2.5 font-medium shadow-sm flex items-center gap-2">
            <span>+ Добавить локацию</span>
          </button>
        </div>
        <div class="card overflow-hidden">
          <table class="w-full text-left border-collapse">
            <thead class="bg-beige-50">
              <tr>
                <th class="py-4 px-6">Город</th>
                <th class="py-4 px-6">Название</th>
                <th class="py-4 px-6">Адрес</th>
                <th class="py-4 px-6 text-right">Действия</th>
              </tr>
            </thead>
            <tbody id="locationsTable" class="text-sm text-gray-700"></tbody>
          </table>
        </div>
      </div>

      <!-- TAB: Bonus -->
      <div id="content-bonus" class="hidden space-y-6">
        <div class="bonus-workspace">
          <aside class="bonus-menu">
            <button onclick="switchBonusPage('term')" id="bonus-nav-term" class="bonus-nav-active"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h4"></path></svg>Срок действия</button>
            <button onclick="switchBonusPage('writeoff')" id="bonus-nav-writeoff" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7Z"></path><path d="M8 7V5a4 4 0 0 1 8 0v2M9 12h6M9 16h4"></path></svg>Списание</button>
            <button onclick="switchBonusPage('mode')" id="bonus-nav-mode" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path><circle cx="9" cy="12" r="3"></circle><path d="M14 6h5M5 18h5"></path><circle cx="14" cy="18" r="3"></circle><circle cx="10" cy="6" r="3"></circle></svg>Активация</button>
            <button onclick="switchBonusPage('birthday')" id="bonus-nav-birthday" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM4 15h16M12 11v9M7 11c-2-2-1-5 2-5 2 0 3 2 3 5M17 11c2-2 1-5-2-5-2 0-3 2-3 5"></path></svg>День рождения</button>
            <button onclick="switchBonusPage('photos')" id="bonus-nav-photos" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="M7 17l4-4 3 3 2-2 3 3"></path></svg>Фотографии</button>
            <button onclick="switchBonusPage('standard')" id="bonus-nav-standard" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>Стандартный</button>
            <button onclick="switchBonusPage('corporate')" id="bonus-nav-corporate" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01"></path></svg>Корпоративный</button>
            <button onclick="switchBonusPage('gradation')" id="bonus-nav-gradation" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-7M3 19h18"></path></svg>Накопительный</button>
            <button onclick="switchBonusPage('promocode')" id="bonus-nav-promocode" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"></rect><path d="M8 9h8M8 13h5M15 16h1"></path></svg>Сумма транзакций</button>
            <button onclick="switchBonusPage('automailing')" id="bonus-nav-automailing" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-7-4 15-4-6-8-2Z"></path><path d="M12 14l4-9"></path></svg>Авторассылка</button>
            <button onclick="switchBonusPage('referral')" id="bonus-nav-referral" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="17" cy="16" r="3"></circle><path d="M11 9.5l3.5 3.5M5 18c.8-2 2.2-3 4-3"></path></svg>Реферальная система</button>
            <button onclick="switchBonusPage('cross')" id="bonus-nav-cross" class="bonus-nav"><svg class="bonus-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path><circle cx="7" cy="7" r="3"></circle><circle cx="17" cy="17" r="3"></circle></svg>Cross</button>
          </aside>

          <section class="min-w-0">
        <div id="bonus-page-mode" class="bonus-page hidden grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="card p-5 lg:col-span-2">
            <h3 class="font-bold text-gray-800 mb-4">Режим начисления</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label class="bonus-option"><input type="radio" name="bonus_mode" value="cashback"> Кэшбэк от суммы</label>
              <label class="bonus-option"><input type="radio" name="bonus_mode" value="accumulative"> Накопительный</label>
              <label class="bonus-option"><input type="radio" name="bonus_mode" value="cascade"> Каскад по источникам</label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <label class="block text-sm">Базовый кэшбэк (%)<input type="number" id="bonus_standard_percent" class="input-classic w-full mt-1"></label>
              <label class="block text-sm">Лимит оплаты (%)<input type="number" id="bonus_max_discount" class="input-classic w-full mt-1"></label>
              <label class="block text-sm">Бонус за первую покупку<input type="number" id="bonus_first_transaction" class="input-classic w-full mt-1"></label>
            </div>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Активация</h3>
            <label class="flex items-center gap-2 mb-3"><input type="checkbox" id="bonus_activation_enabled"> Включена</label>
            <label class="block text-sm mb-3">Задержка активации, дней<input type="number" id="bonus_activation_delay" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Текст уведомления<textarea id="bonus_first_notification" rows="4" class="input-classic w-full mt-1"></textarea></label>
          </div>
        </div>

        <div id="bonus-page-standard" class="bonus-page hidden grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Стандартные правила</h3>
            <label class="block text-sm mb-3">Начислять бонусов (%)<input type="number" id="bonus_standard_cashback" class="input-classic w-full mt-1"></label>
            <label class="block text-sm mb-3">Максимум оплаты бонусами (%)<input type="number" id="bonus_standard_write_limit" class="input-classic w-full mt-1"></label>
            <label class="flex items-center gap-2"><input type="checkbox" id="bonus_apply_to_all"> Применять ко всем филиалам и источникам</label>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Источники</h3>
            <div class="grid grid-cols-2 gap-3">
              <label class="bonus-option"><input type="checkbox" id="bonus_source_pos"> iiko POS</label>
              <label class="bonus-option"><input type="checkbox" id="bonus_source_app"> Мобильное приложение</label>
              <label class="bonus-option"><input type="checkbox" id="bonus_source_certificate"> Сертификаты</label>
              <label class="bonus-option"><input type="checkbox" id="bonus_source_manual"> Ручные операции</label>
            </div>
          </div>
        </div>

        <div id="bonus-page-gradation" class="bonus-page hidden grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="card p-5 border-l-4 border-l-gray-400">
            <h3 class="font-bold text-gray-700 mb-3">Bronze</h3>
            <label class="block text-sm">Кэшбэк (%)<input type="number" id="bonus_grad_bronze" class="input-classic w-full mt-1"></label>
          </div>
          <div class="card p-5 border-l-4 border-l-yellow-400">
            <h3 class="font-bold text-yellow-700 mb-3">Gold</h3>
            <label class="block text-sm mb-3">Порог<input type="number" id="bonus_grad_gold_th" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Кэшбэк (%)<input type="number" id="bonus_grad_gold_cb" class="input-classic w-full mt-1"></label>
          </div>
          <div class="card p-5 border-l-4 border-l-blue-300">
            <h3 class="font-bold text-blue-800 mb-3">Platinum</h3>
            <label class="block text-sm mb-3">Порог<input type="number" id="bonus_grad_platinum_th" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Кэшбэк (%)<input type="number" id="bonus_grad_platinum_cb" class="input-classic w-full mt-1"></label>
          </div>
        </div>

        <div id="bonus-page-term" class="bonus-page">
          <div class="bonus-form-section">
            <label for="bonus_expiration_mode">Сгорание <span class="required">*</span></label>
            <select id="bonus_expiration_mode" class="input-classic w-full h-14">
              <option value=""></option>
              <option value="50">50%</option>
              <option value="100">100%</option>
            </select>
          </div>
          <div class="bonus-form-section">
            <label for="bonus_expiration_period">Период <span class="required">*</span></label>
            <select id="bonus_expiration_period" class="input-classic w-full h-14">
              <option value="none">Без срока</option>
              <option value="two_weeks">Две недели</option>
              <option value="month">Месяц</option>
              <option value="two_months">Два месяца</option>
              <option value="three_months">Три месяца</option>
              <option value="half_year">Полгода</option>
              <option value="year">Год</option>
              <option value="one_half_year">Полтора года</option>
              <option value="two_years">2 года</option>
              <option value="custom">Свой срок</option>
            </select>
          </div>
          <div class="bonus-form-section">
            <label for="bonus_bonus_name">Название бонусов</label>
            <input id="bonus_bonus_name" class="input-classic w-full h-11" placeholder="например, баллы, монеты, кредиты">
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <label class="block text-sm">Срок действия, дней<input type="number" id="bonus_expiration_days" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Напомнить за, дней<input type="number" id="bonus_notify_before" class="input-classic w-full mt-1"></label>
            <label class="flex items-center gap-2 text-sm pt-7"><input type="checkbox" id="bonus_auto_writeoff"> Автосписание</label>
          </div>
          <button onclick="saveBonusSettings()" id="bonusSaveBtn" class="bonus-save-inline">Сохранить</button>
        </div>

        <div id="bonus-page-writeoff" class="bonus-page hidden">
          <div class="bonus-form-section">
            <label for="bonus_writeoff_percent">Списание <span class="required">*</span></label>
            <select id="bonus_writeoff_percent" class="input-classic w-full h-14">
              <option value=""></option>
              <option value="10">10%</option>
              <option value="20">20%</option>
              <option value="25">25%</option>
              <option value="30">30%</option>
              <option value="40">40%</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
            </select>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <label class="block text-sm">Минимальный чек<input type="number" id="bonus_writeoff_min_check" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Шаг списания<input type="number" id="bonus_writeoff_step" class="input-classic w-full mt-1"></label>
          </div>
          <button onclick="saveBonusSettings()" class="bonus-save-inline">Сохранить</button>
        </div>

        <div id="bonus-page-birthday" class="bonus-page hidden grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Бонус ко дню рождения</h3>
            <label class="flex items-center gap-2 mb-3"><input type="checkbox" id="bonus_birthday_enabled"> Включить</label>
            <label class="block text-sm mb-3">Количество бонусов<input type="number" id="bonus_birthday_amount" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Срок действия, дней<input type="number" id="bonus_birthday_expiration" class="input-classic w-full mt-1"></label>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Сообщение</h3>
            <textarea id="bonus_birthday_message" rows="7" class="input-classic w-full"></textarea>
          </div>
        </div>

        <div id="bonus-page-promocode" class="bonus-page hidden space-y-4">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Добавить промокод</h3>
            <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input id="promo_code" class="input-classic" placeholder="KOFEBONUS">
              <input id="promo_bonus" type="number" class="input-classic" placeholder="Бонусы">
              <input id="promo_limit" type="number" class="input-classic" placeholder="Лимит">
              <input id="promo_until" type="date" class="input-classic">
              <button onclick="addPromocode()" class="btn-classic px-4 py-2">Добавить</button>
            </div>
          </div>
          <div class="card overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead class="bg-beige-50"><tr><th class="py-3 px-4">Код</th><th class="py-3 px-4">Бонусы</th><th class="py-3 px-4">Лимит</th><th class="py-3 px-4">До</th><th class="py-3 px-4 text-right">Действия</th></tr></thead>
              <tbody id="promocodeTable"></tbody>
            </table>
          </div>
        </div>

        <div id="bonus-page-cross" class="bonus-page hidden grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Кросс бонусы</h3>
            <label class="flex items-center gap-2 mb-4"><input type="checkbox" id="bonus_cross_enabled"> Включить cross-бонусы</label>
            <label class="block text-sm mb-3">Бонусы новым клиентам<input type="number" id="bonus_cross_new_clients" class="input-classic w-full mt-1"></label>
            <label class="block text-sm mb-3">Бонусы лояльным клиентам<input type="number" id="bonus_cross_loyal_clients" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Минимальный чек<input type="number" id="bonus_cross_min_check" class="input-classic w-full mt-1"></label>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Период и город</h3>
            <label class="block text-sm mb-3">Период
              <select id="bonus_cross_period" class="input-classic w-full mt-1">
                <option value="none">Без срока</option>
                <option value="week">Неделя</option>
                <option value="two_weeks">Две недели</option>
                <option value="month">Месяц</option>
                <option value="two_months">Два месяца</option>
                <option value="three_months">Три месяца</option>
                <option value="half_year">Полгода</option>
                <option value="year">Год</option>
              </select>
            </label>
            <label class="block text-sm mb-3">Город<input id="bonus_cross_city" class="input-classic w-full mt-1" placeholder="Все города"></label>
            <p class="text-sm text-gray-500">Настройка повторяет экран Sagi Business `/profile/bonus/cross`.</p>
          </div>
        </div>

        <div id="bonus-page-referral" class="bonus-page hidden card p-5">
          <h3 class="font-bold text-gray-800 mb-4">Реферальная программа</h3>
          <label class="flex items-center gap-2 mb-4"><input type="checkbox" id="bonus_referral_enabled"> Включить referral</label>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label class="block text-sm">Бонус пригласившему<input type="number" id="bonus_ref_inviter" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Бонус другу<input type="number" id="bonus_ref_friend" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Минимальный первый чек<input type="number" id="bonus_ref_min_order" class="input-classic w-full mt-1"></label>
          </div>
        </div>

        <div id="bonus-page-automailing" class="bonus-page hidden grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Авторассылка</h3>
            <label class="flex items-center gap-2 mb-3"><input type="checkbox" id="bonus_auto_enabled"> Включить</label>
            <label class="block text-sm">Неактивность, дней<input type="number" id="bonus_auto_days" class="input-classic w-full mt-1"></label>
          </div>
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Текст</h3>
            <textarea id="bonus_auto_message" rows="7" class="input-classic w-full"></textarea>
          </div>
        </div>

        <div id="bonus-page-photos" class="bonus-page hidden grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Брендированная карта</h3>
            <label class="block text-sm mb-3">Название карты<input id="bonus_card_title" class="input-classic w-full mt-1"></label>
            <label class="block text-sm mb-3">URL баннера<input id="bonus_banner_url" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">URL логотипа<input id="bonus_logo_url" class="input-classic w-full mt-1"></label>
          </div>
          <div class="md:col-span-2 card p-5">
            <h3 class="font-bold text-gray-800 mb-4">Превью</h3>
            <div class="rounded-lg overflow-hidden border border-beige-200 bg-beige-50 max-w-md">
              <div id="bonusCardPreview" class="h-40 bg-cover bg-center flex items-end p-5" style="background-image: linear-gradient(135deg, #ffb300, #7e5d40);">
                <div class="bg-white/90 rounded p-3">
                  <p id="bonusCardPreviewTitle" class="font-bold text-beige-900">Bulka Bonus</p>
                  <p class="text-sm text-gray-600">Баланс, QR, статус гостя</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="bonus-page-corporate" class="bonus-page hidden card p-5">
          <h3 class="font-bold text-gray-800 mb-4">Корпоративные бонусы</h3>
          <label class="flex items-center gap-2 mb-4"><input type="checkbox" id="bonus_corp_enabled"> Включить corporate-сценарий</label>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label class="block text-sm">Компания<input id="bonus_corp_company" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Месячный лимит<input type="number" id="bonus_corp_limit" class="input-classic w-full mt-1"></label>
            <label class="block text-sm">Кэшбэк сотрудникам (%)<input type="number" id="bonus_corp_cashback" class="input-classic w-full mt-1"></label>
          </div>
        </div>

            <div class="pt-6 mt-6 border-t border-[#eef0f4]">
              <button onclick="saveBonusSettings()" class="bonus-save-inline">Сохранить</button>
            </div>
            <p id="bonusSaveMsg" class="text-sm font-medium text-green-600 hidden mt-4">Бонусный модуль сохранен.</p>
          </section>
        </div>
      </div>

      <!-- TAB: Settings -->
      <div id="content-settings" class="hidden space-y-8 max-w-2xl">
        <h2 class="text-xl font-serif text-beige-800 mb-2 border-b border-beige-200 pb-2">Многоуровневая система лояльности</h2>
        
        <div class="grid grid-cols-1 gap-6">
          <div class="card p-4 border-l-4 border-l-gray-400">
            <h3 class="font-bold text-gray-700 mb-2">Бронза (Базовый)</h3>
            <label class="block text-sm text-gray-600 mb-1">Кэшбэк (%)</label>
            <input type="number" id="base_cashback_percent" class="input-classic w-full max-w-xs">
          </div>

          <div class="card p-4 border-l-4 border-l-gray-300">
            <h3 class="font-bold text-gray-500 mb-2">Серебро</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-600 mb-1">Порог (тнг)</label>
                <input type="number" id="tier_silver_th" class="input-classic w-full">
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">Кэшбэк (%)</label>
                <input type="number" id="tier_silver_cb" class="input-classic w-full">
              </div>
            </div>
          </div>

          <div class="card p-4 border-l-4 border-l-yellow-400">
            <h3 class="font-bold text-yellow-600 mb-2">Золото</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-600 mb-1">Порог (тнг)</label>
                <input type="number" id="tier_gold_th" class="input-classic w-full">
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">Кэшбэк (%)</label>
                <input type="number" id="tier_gold_cb" class="input-classic w-full">
              </div>
            </div>
          </div>

          <div class="card p-4 border-l-4 border-l-blue-200">
            <h3 class="font-bold text-blue-800 mb-2">Платина (VIP)</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-600 mb-1">Порог (тнг)</label>
                <input type="number" id="tier_platinum_th" class="input-classic w-full">
              </div>
              <div>
                <label class="block text-sm text-gray-600 mb-1">Кэшбэк (%)</label>
                <input type="number" id="tier_platinum_cb" class="input-classic w-full">
              </div>
            </div>
          </div>
        </div>

        <div class="pt-4 border-t border-beige-200 mt-8">
          <label class="block text-sm text-beige-800 mb-2 font-semibold">Лимит оплаты бонусами (%)</label>
          <input type="number" id="max_discount_percent" class="input-classic w-full text-xl text-red-700 max-w-xs">
          <p class="text-xs text-gray-500 mt-2">Какую максимальную часть чека можно оплатить бонусами.</p>
        </div>

        <div class="pt-6">
          <button onclick="saveSettings()" id="saveBtn" class="btn-classic w-full py-4 font-semibold text-lg">
            Сохранить настройки
          </button>
          <p id="saveMsg" class="text-center mt-3 text-green-600 font-medium hidden">Настройки успешно сохранены!</p>
        </div>
      </div>

      </div>
    </main>
  </div>

  <div id="modal-location" class="sagi-modal hidden">
    <div class="sagi-modal-content">
      <h2 id="modalLocationTitle" class="text-xl font-bold mb-4">Добавить локацию</h2>
      <input type="hidden" id="modalLocationId">
      <div class="space-y-4">
        <div><label class="block text-sm mb-1">Город</label><input type="text" id="modalLocationCity" class="input-classic w-full"></div>
        <div><label class="block text-sm mb-1">Название</label><input type="text" id="modalLocationName" class="input-classic w-full"></div>
        <div><label class="block text-sm mb-1">Адрес</label><input type="text" id="modalLocationAddress" class="input-classic w-full"></div>
      </div>
      <div class="flex justify-end gap-3 mt-6">
        <button onclick="closeLocationModal()" class="btn-outline px-4 py-2">Отмена</button>
        <button onclick="saveLocation()" class="btn-classic px-4 py-2" id="btnSaveLocation">Сохранить</button>
      </div>
    </div>
  </div>

  <script>
    let token = localStorage.getItem('adminToken') || '';
    let currentData = { customers: [], transactions: [], iikoOperations: [], stats: {}, bonusSettings: {}, promocodes: [], stories: [], news: [], locations: [] };
    let chartInstance = null;

    if(token) initApp();

    async function login() {
      token = document.getElementById('adminPwd').value;
      const success = await fetchSettings();
      if(success) {
        localStorage.setItem('adminToken', token);
        document.getElementById('authModal').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        initApp();
      } else {
        document.getElementById('authError').classList.remove('hidden');
      }
    }

    function logout() {
      localStorage.removeItem('adminToken');
      location.reload();
    }

    async function initApp() {
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      await Promise.all([fetchSettings(), fetchStats(), fetchCustomers(), fetchTransactions(), fetchIikoOperations(), fetchStories(), fetchNews(), fetchLocations()]);
      bindBonusInputs();
      renderChart();
    }

    function switchTab(tabId) {
      const titles = {
        analytics: ['Аналитика', 'Обзор продаж, клиентов и бонусов'],
        customers: ['База клиентов', 'Клиенты, статусы, бонусы, покупки, теги, рассылки'],
        transactions: ['Транзакции', 'Оплаты, сертификаты, начисления и списания бонусов'],
        iiko: ['iiko Front', 'Доставка начислений с касс и ошибки интеграции'],
        bonus: ['Бонусы', 'Сроки, списание, стандартный бонус, referral и cross'],
        stories: ['Фотографии / Сториз', 'Рекламные материалы мобильного приложения'],
        news: ['Новости', 'Лента новостей мобильного приложения'],
        locations: ['Локации', 'Управление городами и точками'],
        broadcast: ['WhatsApp / Рассылки', 'Массовые и автоматические уведомления'],
        settings: ['Общая информация', 'Настройки программы лояльности и безопасности']
      };
      ['analytics', 'customers', 'transactions', 'iiko', 'bonus', 'settings', 'broadcast', 'stories', 'news', 'locations'].forEach(id => {
        document.getElementById('content-' + id).classList.add('hidden');
        const tab = document.getElementById('tab-' + id);
        if (tab) tab.className = 'sagi-nav-link';
      });
      document.getElementById('content-' + tabId).classList.remove('hidden');
      const activeTab = document.getElementById('tab-' + tabId);
      if (activeTab) activeTab.className = 'sagi-nav-link-active';
      if (titles[tabId]) {
        document.getElementById('pageTitle').innerText = titles[tabId][0];
        document.getElementById('pageSubtitle').innerText = titles[tabId][1];
      }
      requestAnimationFrame(enhanceResponsiveTables);
    }

    function enhanceResponsiveTables() {
      document.querySelectorAll('table').forEach(table => {
        table.classList.add('responsive-table');
        const labels = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(row => {
          Array.from(row.children).forEach((cell, index) => {
            if (labels[index]) cell.setAttribute('data-label', labels[index]);
          });
        });
      });
    }

    const responsiveTableObserver = new MutationObserver(() => {
      clearTimeout(window.__responsiveTableTimer);
      window.__responsiveTableTimer = setTimeout(enhanceResponsiveTables, 50);
    });
    window.addEventListener('DOMContentLoaded', () => {
      const dashboard = document.getElementById('dashboard');
      if (dashboard) responsiveTableObserver.observe(dashboard, { childList: true, subtree: true });
      enhanceResponsiveTables();
    });

    async function apiGet(endpoint) {
      const res = await fetch('/admin/api/' + endpoint, { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json().catch(() => ({}));
      if(res.status === 401) {
        localStorage.removeItem('adminToken');
        token = '';
        document.getElementById('authModal').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
        throw new Error(data.error || 'Пароль админки неверный. Войдите заново.');
      }
      if(!res.ok) throw new Error(data.error || `API error ${res.status}`);
      return data;
    }

    function setValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    }

    function setChecked(id, value) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(value);
    }

    function getNumber(id, fallback = 0) {
      const el = document.getElementById(id);
      if (!el || el.value === '') return fallback;
      return Number(el.value);
    }

    function getValue(id, fallback = '') {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    }

    function getChecked(id) {
      const el = document.getElementById(id);
      return Boolean(el && el.checked);
    }

    function switchBonusPage(pageId) {
      ['mode', 'standard', 'gradation', 'term', 'writeoff', 'birthday', 'promocode', 'cross', 'referral', 'automailing', 'photos', 'corporate'].forEach(id => {
        const page = document.getElementById('bonus-page-' + id);
        const nav = document.getElementById('bonus-nav-' + id);
        if (page) page.classList.toggle('hidden', id !== pageId);
        if (nav) {
          nav.className = id === pageId ? 'bonus-nav-active' : 'bonus-nav';
          nav.setAttribute('aria-current', id === pageId ? 'page' : 'false');
        }
      });
    }

    async function fetchSettings() {
      try {
        const data = await apiGet('settings');
        document.getElementById('base_cashback_percent').value = data.base_cashback_percent || 3;
        document.getElementById('tier_silver_th').value = data.tier_silver_th || 50000;
        document.getElementById('tier_silver_cb').value = data.tier_silver_cb || 5;
        document.getElementById('tier_gold_th').value = data.tier_gold_th || 150000;
        document.getElementById('tier_gold_cb').value = data.tier_gold_cb || 7;
        document.getElementById('tier_platinum_th').value = data.tier_platinum_th || 300000;
        document.getElementById('tier_platinum_cb').value = data.tier_platinum_cb || 10;
        document.getElementById('max_discount_percent').value = data.max_discount_percent || 50;
        const localBonusSettings = JSON.parse(localStorage.getItem('bonusSettingsDraft') || '{}');
        hydrateBonusSettings(Object.assign({}, data, localBonusSettings));
        return true;
      } catch (e) { return false; }
    }

    function hydrateBonusSettings(data) {
      const activation = data.bonus_activation || {};
      const expiration = data.bonus_expiration || {};
      const birthday = data.bonus_birthday || {};
      const cross = data.bonus_cross || {};
      const referral = data.bonus_referral || {};
      const automailing = data.bonus_automailing || {};
      const media = data.bonus_card_media || {};
      const corporate = data.bonus_corporate || {};

      currentData.bonusSettings = data;
      currentData.promocodes = Array.isArray(data.bonus_promocodes) ? data.bonus_promocodes : [];

      const mode = data.bonus_mode || 'cashback';
      const modeInput = document.querySelector(`input[name="bonus_mode"][value="${mode}"]`);
      if (modeInput) modeInput.checked = true;
      setValue('bonus_standard_percent', data.base_cashback_percent || 3);
      setValue('bonus_max_discount', data.max_discount_percent || 50);
      setValue('bonus_first_transaction', activation.first_transaction_bonus || 0);
      setChecked('bonus_activation_enabled', activation.enabled !== false);
      setValue('bonus_activation_delay', activation.delay_days || 0);
      setValue('bonus_first_notification', activation.first_transaction_notification || '');

      setValue('bonus_standard_cashback', data.base_cashback_percent || 3);
      setValue('bonus_standard_write_limit', data.max_discount_percent || 50);
      setChecked('bonus_apply_to_all', data.bonus_apply_to_all !== false);
      setChecked('bonus_source_pos', data.bonus_source_pos !== false);
      setChecked('bonus_source_app', data.bonus_source_app !== false);
      setChecked('bonus_source_certificate', Boolean(data.bonus_source_certificate));
      setChecked('bonus_source_manual', data.bonus_source_manual !== false);

      setValue('bonus_grad_bronze', data.base_cashback_percent || 3);
      setValue('bonus_grad_gold_th', data.tier_gold_th || 150000);
      setValue('bonus_grad_gold_cb', data.tier_gold_cb || 7);
      setValue('bonus_grad_platinum_th', data.tier_platinum_th || 300000);
      setValue('bonus_grad_platinum_cb', data.tier_platinum_cb || 10);

      setChecked('bonus_expiration_enabled', expiration.enabled !== false);
      setValue('bonus_expiration_mode', expiration.mode || expiration.burn_percent || '');
      setValue('bonus_expiration_period', expiration.period || 'none');
      setValue('bonus_bonus_name', data.bonus_name || 'Бонусы');
      setValue('bonus_expiration_days', expiration.expiration_days || 90);
      setValue('bonus_notify_before', expiration.notify_before_days || 30);
      setChecked('bonus_auto_writeoff', expiration.auto_write_off !== false);
      setValue('bonus_writeoff_percent', data.max_discount_percent || 50);
      setValue('bonus_writeoff_min_check', data.bonus_writeoff_min_check || 0);
      setValue('bonus_writeoff_step', data.bonus_writeoff_step || 1);

      setChecked('bonus_birthday_enabled', birthday.enabled !== false);
      setValue('bonus_birthday_amount', birthday.bonus_amount || 500);
      setValue('bonus_birthday_expiration', birthday.expiration_days || 14);
      setValue('bonus_birthday_message', birthday.message || '');

      setChecked('bonus_cross_enabled', Boolean(cross.enabled));
      setValue('bonus_cross_new_clients', cross.new_clients_bonus || cross.source_bonus || 0);
      setValue('bonus_cross_loyal_clients', cross.loyal_clients_bonus || 0);
      setValue('bonus_cross_min_check', cross.min_check || 0);
      setValue('bonus_cross_period', cross.period || 'none');
      setValue('bonus_cross_city', cross.city || 'Все города');

      setChecked('bonus_referral_enabled', Boolean(referral.enabled));
      setValue('bonus_ref_inviter', referral.inviter_bonus || 300);
      setValue('bonus_ref_friend', referral.friend_bonus || 300);
      setValue('bonus_ref_min_order', referral.min_first_order || 0);

      setChecked('bonus_auto_enabled', Boolean(automailing.enabled));
      setValue('bonus_auto_days', automailing.inactive_days || 30);
      setValue('bonus_auto_message', automailing.message || '');

      setValue('bonus_card_title', media.card_title || 'Bulka Bonus');
      setValue('bonus_banner_url', media.banner_url || '');
      setValue('bonus_logo_url', media.logo_url || '');
      updateBonusCardPreview();

      setChecked('bonus_corp_enabled', Boolean(corporate.enabled));
      setValue('bonus_corp_company', corporate.company_name || '');
      setValue('bonus_corp_limit', corporate.monthly_limit || 0);
      setValue('bonus_corp_cashback', corporate.employee_cashback_percent || 5);
      renderPromocodes();
    }

    function renderPromocodes() {
      const tbody = document.getElementById('promocodeTable');
      if (!tbody) return;
      tbody.innerHTML = (currentData.promocodes || []).map((p, index) => `
        <tr>
          <td class="py-3 px-4 font-bold">${p.code}</td>
          <td class="py-3 px-4">${p.bonus}</td>
          <td class="py-3 px-4">${p.limit || '-'}</td>
          <td class="py-3 px-4">${p.until || '-'}</td>
          <td class="py-3 px-4 text-right"><button onclick="removePromocode(${index})" class="text-red-600 text-sm font-semibold">Удалить</button></td>
        </tr>
      `).join('') || '<tr><td class="py-4 px-4 text-gray-400" colspan="5">Промокодов пока нет</td></tr>';
    }

    function addPromocode() {
      const code = getValue('promo_code').trim().toUpperCase();
      const bonus = getNumber('promo_bonus');
      if (!code || !bonus) {
        alert('Укажите код и сумму бонусов');
        return;
      }
      currentData.promocodes.push({
        id: Date.now(),
        code,
        bonus,
        limit: getNumber('promo_limit'),
        until: getValue('promo_until')
      });
      ['promo_code', 'promo_bonus', 'promo_limit', 'promo_until'].forEach(id => setValue(id, ''));
      renderPromocodes();
    }

    function removePromocode(index) {
      currentData.promocodes.splice(index, 1);
      renderPromocodes();
    }

    function updateBonusCardPreview() {
      const title = getValue('bonus_card_title', 'Bulka Bonus');
      const banner = getValue('bonus_banner_url');
      const preview = document.getElementById('bonusCardPreview');
      const titleEl = document.getElementById('bonusCardPreviewTitle');
      if (titleEl) titleEl.innerText = title || 'Bulka Bonus';
      if (preview) {
        preview.style.backgroundImage = banner
          ? `linear-gradient(0deg, rgba(0,0,0,0.2), rgba(0,0,0,0.05)), url("${banner}")`
          : 'linear-gradient(135deg, #ffb300, #7e5d40)';
      }
    }

    function collectBonusSettingsPayload() {
      const selectedMode = document.querySelector('input[name="bonus_mode"]:checked');
      return {
        bonus_mode: selectedMode ? selectedMode.value : 'cashback',
        base_cashback_percent: getNumber('bonus_standard_cashback', getNumber('bonus_standard_percent', 3)),
        max_discount_percent: getNumber('bonus_writeoff_percent', getNumber('bonus_standard_write_limit', getNumber('bonus_max_discount', 50))),
        tier_gold_th: getNumber('bonus_grad_gold_th', 150000),
        tier_gold_cb: getNumber('bonus_grad_gold_cb', 7),
        tier_platinum_th: getNumber('bonus_grad_platinum_th', 300000),
        tier_platinum_cb: getNumber('bonus_grad_platinum_cb', 10),
        bonus_name: getValue('bonus_bonus_name', 'Бонусы'),
        bonus_apply_to_all: getChecked('bonus_apply_to_all'),
        bonus_source_pos: getChecked('bonus_source_pos'),
        bonus_source_app: getChecked('bonus_source_app'),
        bonus_source_certificate: getChecked('bonus_source_certificate'),
        bonus_source_manual: getChecked('bonus_source_manual'),
        bonus_writeoff_min_check: getNumber('bonus_writeoff_min_check'),
        bonus_writeoff_step: getNumber('bonus_writeoff_step', 1),
        bonus_activation: {
          enabled: getChecked('bonus_activation_enabled'),
          delay_days: getNumber('bonus_activation_delay'),
          first_transaction_bonus: getNumber('bonus_first_transaction'),
          first_transaction_notification: getValue('bonus_first_notification')
        },
        bonus_expiration: {
          enabled: Boolean(getValue('bonus_expiration_mode')),
          mode: getValue('bonus_expiration_mode'),
          burn_percent: getNumber('bonus_expiration_mode'),
          period: getValue('bonus_expiration_period', 'none'),
          expiration_days: getNumber('bonus_expiration_days', 90),
          notify_before_days: getNumber('bonus_notify_before', 30),
          auto_write_off: getChecked('bonus_auto_writeoff')
        },
        bonus_birthday: {
          enabled: getChecked('bonus_birthday_enabled'),
          bonus_amount: getNumber('bonus_birthday_amount', 500),
          expiration_days: getNumber('bonus_birthday_expiration', 14),
          message: getValue('bonus_birthday_message')
        },
        bonus_promocodes: currentData.promocodes || [],
        bonus_cross: {
          enabled: getChecked('bonus_cross_enabled'),
          new_clients_bonus: getNumber('bonus_cross_new_clients'),
          loyal_clients_bonus: getNumber('bonus_cross_loyal_clients'),
          period: getValue('bonus_cross_period', 'none'),
          city: getValue('bonus_cross_city', 'Все города'),
          min_check: getNumber('bonus_cross_min_check')
        },
        bonus_referral: {
          enabled: getChecked('bonus_referral_enabled'),
          inviter_bonus: getNumber('bonus_ref_inviter', 300),
          friend_bonus: getNumber('bonus_ref_friend', 300),
          min_first_order: getNumber('bonus_ref_min_order')
        },
        bonus_automailing: {
          enabled: getChecked('bonus_auto_enabled'),
          inactive_days: getNumber('bonus_auto_days', 30),
          message: getValue('bonus_auto_message')
        },
        bonus_card_media: {
          banner_url: getValue('bonus_banner_url'),
          logo_url: getValue('bonus_logo_url'),
          card_title: getValue('bonus_card_title', 'Bulka Bonus')
        },
        bonus_corporate: {
          enabled: getChecked('bonus_corp_enabled'),
          company_name: getValue('bonus_corp_company'),
          monthly_limit: getNumber('bonus_corp_limit'),
          employee_cashback_percent: getNumber('bonus_corp_cashback', 5)
        }
      };
    }

    function bindBonusInputs() {
      if (window.__bonusInputsBound) return;
      window.__bonusInputsBound = true;
      const pairs = [
        ['bonus_standard_percent', 'bonus_standard_cashback'],
        ['bonus_max_discount', 'bonus_standard_write_limit'],
        ['bonus_max_discount', 'bonus_writeoff_percent']
      ];
      pairs.forEach(([a, b]) => {
        const first = document.getElementById(a);
        const second = document.getElementById(b);
        if (!first || !second) return;
        first.addEventListener('input', () => { second.value = first.value; });
        second.addEventListener('input', () => { first.value = second.value; });
        first.addEventListener('change', () => { second.value = first.value; });
        second.addEventListener('change', () => { first.value = second.value; });
      });
      ['bonus_card_title', 'bonus_banner_url'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateBonusCardPreview);
      });
    }

    async function saveBonusSettings() {
      const buttons = Array.from(document.querySelectorAll('#content-bonus button[onclick="saveBonusSettings()"]'));
      const msg = document.getElementById('bonusSaveMsg');
      buttons.forEach(btn => {
        btn.dataset.label = btn.dataset.label || btn.innerText;
        btn.innerText = 'Сохранение...';
        btn.disabled = true;
      });

      try {
        const payload = collectBonusSettingsPayload();
        const res = await fetch('/admin/api/settings', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Save failed');
        localStorage.removeItem('bonusSettingsDraft');
        Object.assign(currentData.bonusSettings, payload);
        hydrateBonusSettings(Object.assign({}, currentData.bonusSettings, payload));
        msg.innerText = 'Бонусный модуль сохранен.';
        msg.className = 'text-sm font-medium text-green-600';
      } catch (e) {
        const payload = collectBonusSettingsPayload();
        localStorage.setItem('bonusSettingsDraft', JSON.stringify(payload));
        msg.innerText = 'Supabase недоступен. Черновик сохранен в браузере, но касса и база эти настройки не получили.';
        msg.className = 'text-sm font-medium text-amber-700';
      }

      msg.classList.remove('hidden');
      buttons.forEach(btn => {
        btn.innerText = btn.dataset.label || 'Сохранить';
        btn.disabled = false;
      });
      setTimeout(() => msg.classList.add('hidden'), 3000);
    }

    async function fetchStats() {
      try {
        const data = await apiGet('stats');
        document.getElementById('stat-customers').innerText = data.totalCustomers || 0;
        document.getElementById('stat-new-customers').innerText = `+${data.newCustomersLast30Days || 0} за 30 дн.`;
        document.getElementById('stat-sales').innerText = (data.totalSales || 0).toLocaleString();
        document.getElementById('stat-bonus-percent').innerText = `${data.bonusPaymentPercent || 0}%`;
        document.getElementById('stat-earned').innerText = (data.totalEarned || 0).toLocaleString();
        document.getElementById('stat-earned-month').innerText = `+${(data.earnedLast30Days || 0).toLocaleString()} за 30 дн.`;
        document.getElementById('stat-burned').innerText = (data.totalBurned || 0).toLocaleString();
        document.getElementById('stat-burned-month').innerText = `+${(data.burnedLast30Days || 0).toLocaleString()} за 30 дн.`;
        document.getElementById('stat-liabilities').innerText = (data.currentLiabilities || 0).toLocaleString();
        currentData.stats = data;
        renderChart();
      } catch (e) { console.error(e); }
    }

    async function fetchCustomers() {
      try {
        document.getElementById('customersTable').innerHTML = '<tr><td colspan="10" class="py-8 px-6 text-center text-gray-400">Загрузка клиентов...</td></tr>';
        currentData.customers = await apiGet('customers');
        renderCustomers();
      } catch (e) {
        console.error(e);
        document.getElementById('customersTable').innerHTML = `
          <tr>
            <td colspan="10" class="py-8 px-6 text-center text-red-600">
              Не удалось загрузить клиентов: ${e.message || 'ошибка Supabase/API'}
            </td>
          </tr>`;
      }
    }

    async function fetchTransactions() {
      try {
        currentData.transactions = await apiGet('transactions');
        renderTransactions();
      } catch (e) { console.error(e); }
    }

    async function fetchIikoOperations() {
      try {
        currentData.iikoOperations = await apiGet('iiko-operations');
        renderIikoOperations();
      } catch (e) { console.error(e); }
    }

    async function fetchStories() {
      try {
        const res = await apiGet('stories');
        const list = res.stories || [];
        currentData.stories = list;
        const tbody = document.getElementById('storiesTable');
        tbody.innerHTML = list.map(s => `
          <tr class="border-b border-beige-100 hover:bg-beige-50">
            <td class="py-3 px-4"><img src="${s.coverUrl}" class="w-12 h-16 object-cover rounded shadow"></td>
            <td class="py-3 px-4 text-xs">
              <div class="font-bold text-gray-800">${s.groupTitle || s.group_title || s.title}</div>
              <div class="text-gray-400">${s.groupId || s.group_id || s.id}</div>
            </td>
            <td class="py-3 px-4 font-bold text-gray-800">${s.title}</td>
            <td class="py-3 px-4 text-xs text-gray-500 max-w-xs truncate">${s.description || '-'}</td>
            <td class="py-3 px-4"><a href="${s.contentUrl}" target="_blank" class="text-blue-600 underline text-xs">Photo link</a></td>
            <td class="py-3 px-4 text-center">${s.duration} сек</td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
              <button onclick="editStoryAdmin(${s.id})" class="bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm mr-2" style="background: #ffb300; color: #3e2723; font-weight: bold;">Изменить</button>
              <button onclick="deleteStoryAdmin(${s.id})" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm">Удалить</button>
            </td>
          </tr>
        `).join('');
      } catch (e) { console.error(e); }
    }

    // --- Locations ---
    async function fetchLocations() {
      try {
        const res = await fetch('/admin/api/locations', { headers: { 'Authorization': `Bearer ${token}` } });
        const json = await res.json();
        if(json.success) { currentData.locations = json.locations; renderLocations(); }
      } catch (err) { console.error('fetchLocations error', err); }
    }

    function renderLocations() {
      const html = (currentData.locations || []).map((loc, idx) => `
        <tr class="border-b last:border-0 hover:bg-beige-50/50">
          <td class="py-4 px-6 font-medium">${loc.city || '—'}</td>
          <td class="py-4 px-6">${loc.name || '—'}</td>
          <td class="py-4 px-6">${loc.address || '—'}</td>
          <td class="py-4 px-6 text-right">
            <button onclick="editLocation(${idx})" class="text-beige-600 hover:text-beige-800 text-sm font-medium mr-3">Редактировать</button>
            <button onclick="deleteLocation('${loc.id}')" class="text-red-500 hover:text-red-700 text-sm font-medium">Удалить</button>
          </td>
        </tr>
      `).join('');
      document.getElementById('locationsTable').innerHTML = html || '<tr><td colspan="4" class="py-6 text-center text-gray-500">Нет локаций</td></tr>';
      enhanceResponsiveTables();
    }

    function openLocationModal() {
      document.getElementById('modalLocationId').value = '';
      document.getElementById('modalLocationCity').value = '';
      document.getElementById('modalLocationName').value = '';
      document.getElementById('modalLocationAddress').value = '';
      document.getElementById('modalLocationTitle').innerText = 'Добавить локацию';
      document.getElementById('modal-location').classList.remove('hidden');
    }

    function closeLocationModal() {
      document.getElementById('modal-location').classList.add('hidden');
    }

    function editLocation(idx) {
      const loc = currentData.locations[idx];
      document.getElementById('modalLocationId').value = loc.id;
      document.getElementById('modalLocationCity').value = loc.city || '';
      document.getElementById('modalLocationName').value = loc.name || '';
      document.getElementById('modalLocationAddress').value = loc.address || '';
      document.getElementById('modalLocationTitle').innerText = 'Редактировать локацию';
      document.getElementById('modal-location').classList.remove('hidden');
    }

    async function saveLocation() {
      const btn = document.getElementById('btnSaveLocation');
      btn.innerText = 'Сохранение...'; btn.disabled = true;
      const id = document.getElementById('modalLocationId').value;
      const city = document.getElementById('modalLocationCity').value;
      const name = document.getElementById('modalLocationName').value;
      const address = document.getElementById('modalLocationAddress').value;
      
      const method = id ? 'PUT' : 'POST';
      const url = id ? '/admin/api/locations/' + id : '/admin/api/locations';
      
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ city, name, address })
        });
        const json = await res.json();
        if(json.success) {
          closeLocationModal();
          await fetchLocations();
        } else alert('Ошибка: ' + (json.error || 'Unknown'));
      } catch (err) { alert('Ошибка сети: ' + err.message); }
      btn.innerText = 'Сохранить'; btn.disabled = false;
    }

    async function deleteLocation(id) {
      if(!confirm('Удалить эту локацию?')) return;
      try {
        const res = await fetch('/admin/api/locations/' + id, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        const json = await res.json();
        if(json.success) await fetchLocations();
        else alert('Ошибка: ' + (json.error || 'Unknown'));
      } catch (err) { alert('Ошибка сети: ' + err.message); }
    }

    async function fetchNews() {
      try {
        const res = await apiGet('news');
        const list = res.news || [];
        currentData.news = list;
        renderNews();
      } catch (e) {
        console.error(e);
        const tbody = document.getElementById('newsTable');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-red-600">Не удалось загрузить новости</td></tr>';
      }
    }

    function renderNews() {
      const tbody = document.getElementById('newsTable');
      if (!tbody) return;
      const list = currentData.news || [];
      tbody.innerHTML = list.map(item => {
        const created = item.created_at ? new Date(item.created_at).toLocaleDateString() : '-';
        return `
          <tr class="border-b border-beige-100 hover:bg-beige-50">
            <td class="py-3 px-4">
              ${item.imageUrl || item.imageurl
                ? `<img src="${item.imageUrl || item.imageurl}" class="w-16 h-16 object-cover rounded shadow">`
                : '<div class="w-16 h-16 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] text-gray-400 text-center px-1">без фото</div>'}
            </td>
            <td class="py-3 px-4 font-bold text-gray-800">${item.title || '-'}</td>
            <td class="py-3 px-4 text-xs text-gray-500 max-w-md truncate">${item.description || '-'}</td>
            <td class="py-3 px-4 text-xs text-gray-500">${created}</td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
              <button onclick="editNewsAdmin(${item.id})" class="bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm mr-2" style="background: #ffb300; color: #3e2723; font-weight: bold;">Изменить</button>
              <button onclick="deleteNewsAdmin(${item.id})" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded text-xs font-medium transition-all shadow-sm">Удалить</button>
            </td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="5" class="py-8 px-6 text-center text-gray-400">Новостей пока нет</td></tr>';
    }

    async function deleteNewsAdmin(id) {
      if (!confirm('Удалить эту новость?')) return;
      await fetch('/admin/api/news/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
      fetchNews();
    }

    async function deleteStoryAdmin(id) {
      if (!confirm('Удалить эту историю?')) return;
      await fetch('/admin/api/stories/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
      fetchStories();
    }

    function updateImagePreview(targetInputId, url) {
      const inputEl = document.getElementById(targetInputId);
      if (inputEl) inputEl.value = url || '';
      
      const previewEl = document.getElementById('preview_' + targetInputId);
      const placeholderEl = document.getElementById('placeholder_' + targetInputId);
      const changeBtnEl = document.getElementById('change_btn_' + targetInputId);
      
      if (url && url !== '' && url !== 'undefined') {
        if (previewEl) {
          previewEl.src = url;
          previewEl.classList.remove('hidden');
        }
        if (placeholderEl) placeholderEl.classList.add('hidden');
        if (changeBtnEl) changeBtnEl.classList.remove('hidden');
      } else {
        if (previewEl) {
          previewEl.src = '';
          previewEl.classList.add('hidden');
        }
        if (placeholderEl) placeholderEl.classList.remove('hidden');
        if (changeBtnEl) changeBtnEl.classList.add('hidden');
      }
    }

    function openStoryModal() {
      document.getElementById('editing_story_id').value = '';
      document.getElementById('storyModalTitle').innerText = 'Создать Сториз (Инстаграм-формат)';
      document.getElementById('story_title').value = '';
      document.getElementById('story_group_title').value = '';
      document.getElementById('story_group_id').value = '';
      updateImagePreview('story_cover', '');
      updateImagePreview('story_content', '');
      document.getElementById('story_desc').value = '';
      document.getElementById('story_duration').value = '15';
      document.getElementById('story_sort_order').value = '0';
      document.getElementById('storyModal').classList.remove('hidden');
    }

    function editStoryAdmin(id) {
      const s = (currentData.stories || []).find(item => String(item.id) === String(id));
      if (!s) return;
      document.getElementById('editing_story_id').value = s.id;
      document.getElementById('storyModalTitle').innerText = 'Редактировать Сториз';
      document.getElementById('story_title').value = s.title || '';
      document.getElementById('story_group_title').value = s.groupTitle || s.group_title || s.title || '';
      document.getElementById('story_group_id').value = s.groupId || s.group_id || s.id || '';
      updateImagePreview('story_cover', s.coverUrl || '');
      updateImagePreview('story_content', s.contentUrl || '');
      document.getElementById('story_desc').value = s.description || '';
      document.getElementById('story_duration').value = s.duration || 15;
      document.getElementById('story_sort_order').value = s.sortOrder || s.sort_order || 0;
      document.getElementById('storyModal').classList.remove('hidden');
    }

    function closeStoryModal() {
      document.getElementById('storyModal').classList.add('hidden');
    }

    function openNewsModal() {
      document.getElementById('editing_news_id').value = '';
      document.getElementById('newsModalTitle').innerText = 'Создать новость';
      document.getElementById('news_title').value = '';
      updateImagePreview('news_image', '');
      document.getElementById('news_desc').value = '';
      document.getElementById('newsModal').classList.remove('hidden');
    }

    function editNewsAdmin(id) {
      const item = (currentData.news || []).find(n => String(n.id) === String(id));
      if (!item) return;
      document.getElementById('editing_news_id').value = item.id;
      document.getElementById('newsModalTitle').innerText = 'Редактировать новость';
      document.getElementById('news_title').value = item.title || '';
      updateImagePreview('news_image', item.imageUrl || item.imageurl || '');
      document.getElementById('news_desc').value = item.description || '';
      document.getElementById('newsModal').classList.remove('hidden');
    }

    function closeNewsModal() {
      document.getElementById('newsModal').classList.add('hidden');
    }

    async function uploadStoryPhoto(fileInput, targetInputId) {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      const statusEl = document.getElementById('status_' + targetInputId);
      statusEl.innerText = 'Загрузка фото в Supabase Storage...';
      statusEl.classList.remove('hidden', 'text-red-600');
      statusEl.classList.add('text-green-600');

      const reader = new FileReader();
      reader.onload = async function(e) {
        const base64 = e.target.result;
        updateImagePreview(targetInputId, base64);
        try {
          const res = await fetch('/admin/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ imageBase64: base64, filename: file.name })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            updateImagePreview(targetInputId, data.url);
            statusEl.innerText = 'Успешно загружено в Supabase Storage!';
            setTimeout(() => statusEl.classList.add('hidden'), 4000);
          } else {
            statusEl.innerText = 'Ошибка: ' + (data.error || 'Не удалось загрузить');
            statusEl.classList.remove('text-green-600');
            statusEl.classList.add('text-red-600');
          }
        } catch (err) {
          statusEl.innerText = 'Ошибка сети при загрузке';
          statusEl.classList.remove('text-green-600');
          statusEl.classList.add('text-red-600');
        }
      };
      reader.readAsDataURL(file);
    }

    async function saveStoryAdmin() {
      const editId = document.getElementById('editing_story_id').value;
      const title = document.getElementById('story_title').value;
      const groupTitle = document.getElementById('story_group_title').value || title;
      const groupId = document.getElementById('story_group_id').value || groupTitle;
      const coverUrl = document.getElementById('story_cover').value;
      const contentUrl = document.getElementById('story_content').value;
      const description = document.getElementById('story_desc').value;
      const duration = document.getElementById('story_duration').value || 15;
      const sortOrder = document.getElementById('story_sort_order').value || 0;
      if (!title || !coverUrl) { alert('Укажите заголовок и фото обложки!'); return; }

      const url = editId ? `/admin/api/stories/${editId}` : '/admin/api/stories';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ title, groupTitle, groupId, groupCoverUrl: coverUrl, coverUrl, contentUrl, description, duration, sortOrder })
      });
      if (!res.ok) {
        alert('Ошибка при сохранении Сториз!');
        return;
      }
      closeStoryModal();
      document.getElementById('editing_story_id').value = '';
      document.getElementById('story_title').value = '';
      document.getElementById('story_group_title').value = '';
      document.getElementById('story_group_id').value = '';
      document.getElementById('story_cover').value = '';
      document.getElementById('story_content').value = '';
      document.getElementById('story_desc').value = '';
      document.getElementById('story_sort_order').value = '0';
      fetchStories();
    }

    async function saveNewsAdmin() {
      const editId = document.getElementById('editing_news_id').value;
      const title = document.getElementById('news_title').value;
      const imageUrl = document.getElementById('news_image').value;
      const description = document.getElementById('news_desc').value;
      if (!title.trim()) { alert('Укажите заголовок новости!'); return; }

      const url = editId ? `/admin/api/news/${editId}` : '/admin/api/news';
      const method = editId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ title, imageUrl, description })
      });
      if (!res.ok) {
        alert('Ошибка при сохранении новости!');
        return;
      }
      closeNewsModal();
      document.getElementById('editing_news_id').value = '';
      document.getElementById('news_title').value = '';
      document.getElementById('news_image').value = '';
      document.getElementById('news_desc').value = '';
      fetchNews();
    }

    async function saveSettings() {
      const btn = document.getElementById('saveBtn');
      btn.innerText = 'Сохранение...';
      const payload = {
        base_cashback_percent: document.getElementById('base_cashback_percent').value,
        tier_silver_th: document.getElementById('tier_silver_th').value,
        tier_silver_cb: document.getElementById('tier_silver_cb').value,
        tier_gold_th: document.getElementById('tier_gold_th').value,
        tier_gold_cb: document.getElementById('tier_gold_cb').value,
        tier_platinum_th: document.getElementById('tier_platinum_th').value,
        tier_platinum_cb: document.getElementById('tier_platinum_cb').value,
        max_discount_percent: document.getElementById('max_discount_percent').value
      };

      await fetch('/admin/api/settings', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      btn.innerText = 'Сохранить настройки';
      const msg = document.getElementById('saveMsg');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 3000);
    }

    async function sendBroadcast() {
      const text = document.getElementById('broadcastText').value.trim();
      if (!text) {
        alert('Введите текст сообщения');
        return;
      }
      if (!confirm('Отправить это сообщение всем клиентам в базе? Отменить это действие будет невозможно.')) return;

      const btn = document.getElementById('btnBroadcast');
      const msgEl = document.getElementById('broadcastMsg');
      btn.disabled = true;
      btn.innerText = 'Отправка...';

      try {
        const res = await fetch('/admin/api/broadcast', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        
        if (res.ok) {
          msgEl.innerText = `Сообщение отправлено. Охват: ${data.count} клиентов.`;
          msgEl.className = 'text-center mt-4 text-sm font-medium text-green-600';
          document.getElementById('broadcastText').value = '';
        } else {
          msgEl.innerText = `Ошибка: ${data.error}`;
          msgEl.className = 'text-center mt-4 text-sm font-medium text-red-600';
        }
      } catch (err) {
        msgEl.innerText = `Ошибка связи с сервером`;
        msgEl.className = 'text-center mt-4 text-sm font-medium text-red-600';
      }
      
      msgEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerText = 'Отправить всем';
    }

    async function manualBonus(customerId) {
      const amount = prompt("Введите сумму бонусов (с минусом для списания):");
      if(!amount || isNaN(amount)) return;
      
      const reason = prompt("Причина (необязательно):") || "Ручное начисление";
      
      const res = await fetch('/admin/api/customers/bonus', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, amount: Number(amount), reason })
      });

      if(res.ok) {
        alert("Успешно!");
        fetchCustomers();
        fetchTransactions();
        fetchStats();
      } else {
        alert("Ошибка!");
      }
    }

    async function promptManualBonusByPhone() {
      const phone = prompt("Введите телефон клиента:");
      if (!phone) return;
      const clean = phone.replace(/\D/g, '');
      const customer = currentData.customers.find(c => (c.phone || '').replace(/\D/g, '').includes(clean) || clean.includes((c.phone || '').replace(/\D/g, '')));
      if (!customer) {
        alert("Клиент не найден в базе");
        return;
      }
      manualBonus(customer.id);
    }

    function editCustomer(id) {
      const c = currentData.customers.find(item => item.id === id);
      if (!c) return;
      document.getElementById('edit_id').value = c.id;
      document.getElementById('edit_name').value = c.name || '';
      document.getElementById('edit_phone').value = c.phone || '';
      document.getElementById('edit_balance').value = c.balance || 0;
      document.getElementById('edit_spent').value = c.total_spent || 0;
      document.getElementById('editModal').classList.remove('hidden');
    }

    function closeEditModal() {
      document.getElementById('editModal').classList.add('hidden');
    }

    function grantVipStatus() {
      const threshold = document.getElementById('vip_threshold')?.value || 100000;
      document.getElementById('edit_spent').value = threshold;
    }

    async function saveCustomerEdit() {
      const btn = document.getElementById('editSaveBtn');
      btn.innerText = 'Сохранение...';
      const customerId = document.getElementById('edit_id').value;
      const payload = {
        customerId,
        name: document.getElementById('edit_name').value,
        phone: document.getElementById('edit_phone').value,
        balance: Number(document.getElementById('edit_balance').value),
        total_spent: Number(document.getElementById('edit_spent').value)
      };
      const res = await fetch('/admin/api/customers/update', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      btn.innerText = 'Сохранить';
      if (res.ok) {
        closeEditModal();
        fetchCustomers();
        fetchStats();
      } else {
        alert('Ошибка при сохранении!');
      }
    }

    async function triggerExpireBonuses() {
      if (!confirm('Запустить проверку неактивных клиентов?\nУ всех гостей, которые не совершали покупки более 90 дней, баллы будут автоматически списаны.')) return;
      const res = await fetch('/admin/api/customers/expire-inactive', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 90 })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Проверка завершена!\nСгорели неактивные бонусы у клиентов: ${data.expiredCount}\nОбщая сумма списанных бонусов: ${data.totalExpiredAmount} бон.`);
        fetchCustomers();
        fetchStats();
        fetchTransactions();
      } else {
        alert('Ошибка при выполнении проверки!');
      }
    }

    async function triggerNotifyInactive() {
      if (!confirm('Запустить проверку и отправку напоминаний?\nУведомления в Telegram будут отправлены всем гостям, которые не приходили более 30 дней и у которых есть положительный баланс бонусов.')) return;
      const res = await fetch('/admin/api/customers/notify-inactive', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Напоминания отправлены!\nГостей, получивших уведомление: ${data.notifiedCount}\nОбщая сумма их баллов под угрозой сгорания: ${data.totalNotifiedBalance} бон.`);
        fetchTransactions();
      } else {
        alert('Ошибка при отправке напоминаний!');
      }
    }

    async function deleteCustomerAction(id) {
      if (!confirm('Вы уверены, что хотите безвозвратно удалить этого клиента и всю историю его транзакций?')) return;
      const res = await fetch('/admin/api/customers/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        alert('Клиент успешно удален.');
        fetchCustomers();
        fetchStats();
        fetchTransactions();
      } else {
        alert('Ошибка при удалении клиента!');
      }
    }

    function renderCustomers() {
      const q = document.getElementById('searchCustomer').value.toLowerCase();
      const filtered = currentData.customers.filter(c => c.name?.toLowerCase().includes(q) || c.phone?.includes(q));
      if (filtered.length === 0) {
        document.getElementById('customersTable').innerHTML = `
          <tr>
            <td colspan="10" class="py-8 px-6 text-center text-gray-400">
              ${currentData.customers.length === 0 ? 'Клиентов не найдено в подключенной Supabase базе.' : 'По фильтру клиентов не найдено.'}
            </td>
          </tr>`;
        return;
      }
      
      const html = filtered.map((c, index) => {
        const spent = Number(c.total_spent || 0);
        const status = spent >= 300000 ? 'Платина' : spent >= 150000 ? 'Золото' : spent >= 50000 ? 'Серебро' : 'Бронза';
        const txCount = c.transaction_count || c.transactions_count || '—';
        return `
        <tr>
          <td class="py-4 px-4 text-gray-400">${index + 1}</td>
          <td class="py-4 px-6 font-medium">${c.name || 'Без имени'}</td>
          <td class="py-4 px-6 text-gray-500">${c.phone}</td>
          <td class="py-4 px-6"><span class="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-xs font-semibold">${status}</span></td>
          <td class="py-4 px-6 text-right">${txCount}</td>
          <td class="py-4 px-6 text-right font-bold text-blue-600">${c.balance}</td>
          <td class="py-4 px-6 text-right text-gray-600">${spent.toLocaleString()}</td>
          <td class="py-4 px-6 text-gray-500">${status}</td>
          <td class="py-4 px-6"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">Активна</span></td>
          <td class="py-4 px-6 text-center space-x-2 whitespace-nowrap">
            <button onclick="manualBonus('${c.id}')" class="btn-outline px-3 py-1 text-xs">+/- Бонусы</button>
            <button onclick="editCustomer('${c.id}')" class="btn-outline px-3 py-1 text-xs">Редактировать</button>
            <button onclick="deleteCustomerAction('${c.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded text-xs font-medium transition-all shadow-sm">Удалить</button>
          </td>
        </tr>
      `}).join('');
      document.getElementById('customersTable').innerHTML = html;
    }

    function exportCustomersCsv() {
      const rows = [['Имя', 'Телефон', 'Баланс', 'Сумма покупок']];
      currentData.customers.forEach(c => rows.push([
        c.name || '',
        c.phone || '',
        c.balance || 0,
        c.total_spent || 0
      ]));
      const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bulka-customers.csv';
      link.click();
      URL.revokeObjectURL(url);
    }

    function renderTransactions() {
      const q = (document.getElementById('searchTransaction')?.value || '').toLowerCase();
      const filtered = currentData.transactions.filter(t => {
        const name = t.customers?.name || '';
        const phone = t.customers?.phone || '';
        const orderId = String(t.order_id || '');
        return name.toLowerCase().includes(q) || phone.includes(q) || orderId.toLowerCase().includes(q);
      });

      const html = filtered.map(t => {
        const d = new Date(t.timestamp).toLocaleString();
        const color = t.type.includes('deposit') ? 'text-green-600' : 'text-red-500';
        const sign = t.type.includes('deposit') ? '+' : '-';
        const name = t.customers ? t.customers.name : 'Unknown';
        const phone = t.customers ? t.customers.phone : '';
        
        let typeStr = t.type;
        if(t.type === 'deposit') typeStr = 'Начисление кэшбэка';
        if(t.type === 'pending_deposit') typeStr = 'Ожидает активации';
        if(t.type === 'withdrawal') typeStr = 'Оплата бонусами';
        if(t.type === 'manual_deposit') typeStr = 'Ручное начисление';
        if(t.type === 'manual_withdrawal') typeStr = 'Ручное списание';
        if(t.type === 'expiration') typeStr = 'Сгорание (90 дней бездействия)';

        let orderBadge = `<span class="bg-beige-100 text-beige-800 font-mono px-2.5 py-1 rounded text-xs border border-beige-200 font-semibold">Чек №${t.order_id || '—'}</span>`;
        if (t.order_id === 'MANUAL' || t.type.includes('manual')) {
          orderBadge = `<span class="bg-purple-100 text-purple-700 font-sans px-2.5 py-1 rounded text-xs border border-purple-200 font-medium">Ручная операция</span>`;
        }
        if (t.type === 'expiration' || t.order_id === 'EXPIRED_90_DAYS') {
          orderBadge = `<span class="bg-orange-100 text-orange-700 font-sans px-2.5 py-1 rounded text-xs border border-orange-200 font-medium">Автосгорание</span>`;
        }

        return `
          <tr>
            <td class="py-4 px-6 text-gray-500 text-xs">${d}</td>
            <td class="py-4 px-6">${orderBadge}</td>
            <td class="py-4 px-6 font-medium">${name}</td>
            <td class="py-4 px-6 text-gray-500">${phone || '—'}</td>
            <td class="py-4 px-6"><span class="bg-gray-100 text-gray-600 px-2.5 py-1 rounded text-xs">Бонусная система</span></td>
            <td class="py-4 px-6 text-right text-gray-700 font-medium">${t.order_total ? t.order_total.toLocaleString() : '—'}</td>
            <td class="py-4 px-6 text-right ${color}">${t.type.includes('withdrawal') ? t.amount : '—'}</td>
            <td class="py-4 px-6 text-right font-bold ${color}">${sign}${t.amount}</td>
            <td class="py-4 px-6"><span class="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded text-xs font-medium">${typeStr}</span></td>
          </tr>
        `;
      }).join('');
      document.getElementById('transactionsTable').innerHTML = html;
    }

    function renderIikoOperations() {
      const rows = currentData.iikoOperations || [];
      const q = (document.getElementById('searchIikoOperation')?.value || '').toLowerCase();
      const filtered = rows.filter(op => {
        const customer = op.customers || {};
        return String(op.order_id || '').toLowerCase().includes(q)
          || String(customer.name || '').toLowerCase().includes(q)
          || String(customer.phone || '').toLowerCase().includes(q)
          || String(op.error_message || '').toLowerCase().includes(q)
          || String(op.status || '').toLowerCase().includes(q);
      });

      const successCount = rows.filter(op => op.status === 'success').length;
      const errorCount = rows.filter(op => op.status === 'error').length;
      const earnedTotal = rows.reduce((sum, op) => sum + Number(op.earned_bonus || 0), 0);
      document.getElementById('iiko-total').innerText = rows.length;
      document.getElementById('iiko-success').innerText = successCount;
      document.getElementById('iiko-errors').innerText = errorCount;
      document.getElementById('iiko-earned').innerText = earnedTotal.toLocaleString();

      const html = filtered.map(op => {
        const d = new Date(op.created_at).toLocaleString();
        const customer = op.customers || {};
        const statusClass = op.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
        const statusText = op.duplicate ? 'Повтор, пропущено' : (op.status === 'success' ? 'Успешно' : 'Ошибка');
        return `
          <tr>
            <td class="py-4 px-6 text-gray-500 text-xs whitespace-nowrap">${d}</td>
            <td class="py-4 px-6 font-mono text-xs">${op.order_id || '—'}</td>
            <td class="py-4 px-6">
              <div class="font-medium">${customer.name || '—'}</div>
              <div class="text-xs text-gray-500">${customer.phone || ''}</div>
            </td>
            <td class="py-4 px-6 text-right">${Number(op.order_total || 0).toLocaleString()}</td>
            <td class="py-4 px-6 text-right text-red-500">${Number(op.discount_amount || 0).toLocaleString()}</td>
            <td class="py-4 px-6 text-right text-emerald-700 font-semibold">${Number(op.earned_bonus || 0).toLocaleString()}</td>
            <td class="py-4 px-6"><span class="${statusClass} px-2.5 py-1 rounded text-xs font-medium">${statusText}</span></td>
            <td class="py-4 px-6 text-xs text-red-600 max-w-md truncate">${op.error_message || '—'}</td>
          </tr>
        `;
      }).join('');

      document.getElementById('iikoOperationsTable').innerHTML = html || '<tr><td colspan="8" class="py-8 px-6 text-center text-gray-500">Операций пока нет</td></tr>';
    }

    let chartInstance2 = null;
    function renderChart() {
      const ctx = document.getElementById('myChart');
      if (!ctx || !currentData.stats) return;
      if(chartInstance) chartInstance.destroy();
      chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Выдано бонусов', 'Потрачено бонусов'],
          datasets: [{
            data: [currentData.stats.totalEarned || 0, currentData.stats.totalBurned || 0],
            backgroundColor: ['#b88c5a', '#7e5d40'],
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { 
              position: 'bottom', 
              labels: { 
                padding: 15,
                font: { family: 'Inter', size: 12 }
              } 
            } 
          },
          cutout: '65%'
        }
      });

      const ctx2 = document.getElementById('chartRevenue');
      if (!ctx2) return;
      if(chartInstance2) chartInstance2.destroy();
      chartInstance2 = new Chart(ctx2, {
        type: 'pie',
        data: {
          labels: ['Живые деньги (тнг)', 'Оплачено бонусами'],
          datasets: [{
            data: [currentData.stats.totalSales || 0, currentData.stats.totalBurned || 0],
            backgroundColor: ['#4ade80', '#f87171'],
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { 
              position: 'bottom', 
              labels: { 
                padding: 15,
                font: { family: 'Inter', size: 12 }
              } 
            } 
          }
        }
      });
    }
  