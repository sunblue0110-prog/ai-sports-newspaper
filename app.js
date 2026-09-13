document.addEventListener('DOMContentLoaded', () => {
  const generateBtn = document.getElementById('generate-btn');
  const printBtn = document.getElementById('print-btn');
  const addSourceBtn = document.getElementById('add-source-btn');
  const newspaperContainer = document.getElementById('newspaper-container');
  const sourceList = document.getElementById('source-list');
  const siteNameInput = document.getElementById('site-name');
  const siteUrlInput = document.getElementById('site-url');
  const apiKeyInput = document.getElementById('api-key');

  // Load from localStorage
  let sources = JSON.parse(localStorage.getItem('aiSportsSources'));
  if (!sources || sources.length === 0) {
    sources = [
      { id: 1, name: '日刊スポーツ（プロ野球）', url: 'https://www.nikkansports.com/baseball/atom.xml' },
      { id: 2, name: '日刊スポーツ（MLB）', url: 'https://www.nikkansports.com/baseball/mlb/atom.xml' }
    ];
    localStorage.setItem('aiSportsSources', JSON.stringify(sources));
  }
  let apiKey = localStorage.getItem('aiSportsApiKey') || '';
  apiKeyInput.value = apiKey;

  apiKeyInput.addEventListener('change', (e) => {
    apiKey = e.target.value.trim();
    localStorage.setItem('aiSportsApiKey', apiKey);
  });

  function saveSources() {
    localStorage.setItem('aiSportsSources', JSON.stringify(sources));
  }

  function renderSources() {
    sourceList.innerHTML = '';
    sources.forEach(source => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${source.name}</span>
        <button class="delete-btn" data-id="${source.id}">削除</button>
      `;
      sourceList.appendChild(li);
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.getAttribute('data-id'));
        sources = sources.filter(s => s.id !== id);
        saveSources();
        renderSources();
      });
    });
  }

  addSourceBtn.addEventListener('click', () => {
    const name = siteNameInput.value.trim();
    const url = siteUrlInput.value.trim();
    if (name && url) {
      sources.push({
        id: Date.now(),
        name,
        url
      });
      siteNameInput.value = '';
      siteUrlInput.value = '';
      saveSources();
      renderSources();
    } else {
      alert('サイト名とURLを入力してください。');
    }
  });

  async function fetchRSS(url) {
    try {
      // Use rss2json as a free CORS proxy
      const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
      const data = await response.json();
      if (data.status === 'ok') {
        return data.items;
      }
      return [];
    } catch (e) {
      console.error('Error fetching RSS:', e);
      return [];
    }
  }

  async function generateArticle() {
    if (!apiKey) {
      alert('Gemini APIキーを入力してください。');
      return;
    }
    if (sources.length === 0) {
      alert('情報源（RSS URL）を1つ以上追加してください。');
      return;
    }

    newspaperContainer.innerHTML = '<div class="placeholder-message no-print">情報源からニュースを取得し、熱狂的な記者を呼び出しています...</div>';

    try {
      // 1. Fetch RSS data
      let allItems = [];
      let images = [];

      for (const source of sources) {
        const items = await fetchRSS(source.url);
        
        // 最新20件ほどのニュースの中から、ランダムに5件をピックアップして話題を広げる
        const shuffledItems = items.sort(() => 0.5 - Math.random());
        const selectedItems = shuffledItems.slice(0, 5);
        
        allItems = allItems.concat(selectedItems); 
        
        for (const item of selectedItems) {
          let imgUrl = null;
          if (item.thumbnail) imgUrl = item.thumbnail;
          else if (item.enclosure && item.enclosure.link && item.enclosure.type && item.enclosure.type.startsWith('image/')) imgUrl = item.enclosure.link;
          else if (item.content) {
            const imgMatch = item.content.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) imgUrl = imgMatch[1];
          }
          if (imgUrl && !images.includes(imgUrl)) {
            images.push(imgUrl);
          }
        }
      }

      if (allItems.length === 0) {
        throw new Error("指定されたURLからニュース情報を取得できませんでした。有効なRSSフィードのURLが登録されているか確認してください。");
      }

      // 最大4枚までの画像を使用
      images = images.slice(0, 4);

      // 2. Prepare prompt
      const newsContext = allItems.map((i, idx) => `[ニュース${idx+1}] タイトル: ${i.title}\n概要: ${i.description.replace(/<[^>]+>/g, '')}`).join('\n\n');
      const prompt = `
あなたは熱狂的なスポーツ新聞のベテラン記者です。以下のスポーツニュースを統合して、1つの熱いスポーツ記事を作成してください。
今回は「写真を多めにし、文章は短め」にすることが条件です。インパクトを重視し、1つの段落は短くしてください。

【重要な条件】
1. 提供されたニュースの中に「日本ハムファイターズ」または「ロサンゼルス・ドジャース」に関する話題が含まれている場合は、それらをメインの記事にしてください。
   もしどちらの話題も含まれていない場合（オフシーズンなど）は、提供された他のスポーツニュースを熱く報じてください。
2. ニュースの内容から「現在の順位表」「勝敗成績」「トーナメント表（勝敗の行方）」などが推測・作成できる場合、あるいはシーズン中と判断できる場合は、記事の途中に必ずHTMLの \`<table>\` タグを用いて【順位表】や【トーナメント表】を作成して挿入してください。（架空の情報になりすぎない範囲で、新聞らしい表を作ってください）

必ず以下のHTMLタグのみを使用して出力してください（Markdownのバッククォート \`\`\`html などは絶対に含めないでください）。
<div class="article-header">
  <h1 class="article-title">[最高に熱い大見出し]</h1>
  <div class="article-meta">[今日の日付] | 熱血スポーツAI特報局</div>
</div>
<div class="article-body">
  [IMAGE_1]
  <h2 class="article-subheading">[小見出し1]</h2>
  <p class="article-text">[短くて熱い本文]</p>
  
  <div class="article-table-container">
    <!-- 順位表やトーナメント表がある場合はここに <table> を使って記述 -->
  </div>

  [IMAGE_2]
  <h2 class="article-subheading">[小見出し2]</h2>
  <p class="article-text">[短くて熱い本文]</p>
  ...
</div>

利用可能な画像のプレースホルダー:
${images.map((_, i) => `[IMAGE_${i+1}]`).join(', ')}
※これらを記事の適切な場所に必ず配置してください（画像がある分だけ全て使ってください）。

以下のニュースを基にしてください：
${newsContext}
      `;

      // 3. Call Gemini API
      newspaperContainer.innerHTML = '<div class="placeholder-message no-print">記事と写真を配置中...</div>';
      
      const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8 }
        })
      });

      const aiData = await apiResponse.json();
      if (aiData.error) {
        throw new Error(aiData.error.message);
      }

      let generatedHtml = aiData.candidates[0].content.parts[0].text;
      
      // Clean up markdown block
      generatedHtml = generatedHtml.replace(/```html/g, '').replace(/```/g, '').trim();

      // Replace image placeholders
      images.forEach((url, i) => {
        generatedHtml = generatedHtml.replace(`[IMAGE_${i+1}]`, `<div class="article-image-container"><img src="${url}" alt="Sports Image"></div>`);
      });
      // Remove any unused placeholders
      generatedHtml = generatedHtml.replace(/\[IMAGE_\d+\]/g, '');

      newspaperContainer.innerHTML = generatedHtml;

    } catch (e) {
      console.error(e);
      newspaperContainer.innerHTML = `<div class="error-message">エラーが発生しました: ${e.message}</div>`;
    }
  }

  generateBtn.addEventListener('click', generateArticle);

  printBtn.addEventListener('click', () => {
    if (newspaperContainer.querySelector('.article-header')) {
      window.print();
    } else {
      alert('まずは記事を生成してください。');
    }
  });

  renderSources();
});
