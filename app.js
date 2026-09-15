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
        
        for (const item of selectedItems) {
          let imgUrl = null;
          if (item.thumbnail) imgUrl = item.thumbnail;
          else if (item.enclosure && item.enclosure.link && item.enclosure.type && item.enclosure.type.startsWith('image/')) imgUrl = item.enclosure.link;
          else if (item.content) {
            const imgMatch = item.content.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) imgUrl = imgMatch[1];
          }
          if (imgUrl && !images.includes(imgUrl) && images.length < 4) {
            images.push(imgUrl);
            item.imagePlaceholder = `[IMAGE_${images.length}]`;
          }
          allItems.push(item);
        }
      }

      if (allItems.length === 0) {
        throw new Error("指定されたURLからニュース情報を取得できませんでした。有効なRSSフィードのURLが登録されているか確認してください。");
      }

      // 2. Prepare prompt
      const newsContext = allItems.map((i, idx) => `[ニュース${idx+1}] タイトル: ${i.title}\n概要: ${i.description.replace(/<[^>]+>/g, '')}${i.imagePlaceholder ? '\n関連画像: ' + i.imagePlaceholder : ''}`).join('\n\n');
            const prompt = `
あなたは熱狂的なスポーツ新聞のベテラン記者です。以下のスポーツニュースを基に、複数の熱いスポーツ記事を作成してください。
今回は「写真を多めにし、文章は短め」にすることが条件です。インパクトを重視し、1つの段落は短くしてください。

【重要な条件】
1. 必ずJSON形式で出力してください。Markdownのバッククォート \`\`\`json などは含めずに純粋なJSONテキストのみを出力してください。
2. 以下のようなJSON構造にしてください。
{
  "mainArticle": {
    "title": "メイン記事の大見出し",
    "meta": "今日の日付 | 熱血スポーツAI特報局",
    "body": "メイン記事のHTML内容（見出し<h2>、段落<p>、テーブル<table>などを含む。画像は不要）"
  },
  "subArticles": [
    {
      "id": 1,
      "heading": "サブ記事の小見出し",
      "body": "サブ記事の本文HTML",
      "imagePlaceholder": "[IMAGE_1]"
    }
  ]
}
3. subArticles は提供されたニュースから【2〜3個】だけ作成してください（これ以上は生成しないでください）。メイン記事で扱わなかったニュースや、関連画像があるニュースを優先してください。
4. 画像について：ニュースに「関連画像」としてプレースホルダー（例: [IMAGE_1]）が記載されている場合、そのプレースホルダーはそのニュースに対応するサブ記事の "imagePlaceholder" に設定してください。無関係な画像を設定しないでください。

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

      let aiText = aiData.candidates[0].content.parts[0].text;
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(aiText);

      window.spareArticles = [];
      let newspaperHtml = `
        <div class="article-header">
          <h1 class="article-title">${parsedData.mainArticle.title}</h1>
          <div class="article-meta">${parsedData.mainArticle.meta}</div>
        </div>
        <div class="article-body">
          <div class="article-block main-article-block">
            ${parsedData.mainArticle.body}
          </div>
      `;

      parsedData.subArticles.forEach((sub, idx) => {
         let imgHtml = '';
         if (sub.imagePlaceholder) {
            const imgMatch = sub.imagePlaceholder.match(/\[IMAGE_(\d+)\]/);
            if (imgMatch) {
               const index = parseInt(imgMatch[1]) - 1;
               if (images[index]) {
                  imgHtml = `<div class="article-image-container"><img src="${images[index]}" alt="Sports Image"></div>`;
               }
            }
         }
         
         const subHtml = `
           ${imgHtml}
           <h2 class="article-subheading">${sub.heading}</h2>
           <p class="article-text">${sub.body}</p>
         `;
         
         // 最初から紙面に載せるのは2つまで。残りは補欠
         if (idx < 2) {
             newspaperHtml += `<div class="article-block sub-article-block" data-id="${sub.id}">${subHtml}</div>`;
         } else {
             window.spareArticles.push({ id: sub.id, html: subHtml, heading: sub.heading });
         }
      });
      
      newspaperHtml += `</div>`;
      newspaperContainer.innerHTML = newspaperHtml;
      
      // Setup swap logic
      setupArticleSwapping();

    } catch (e) {
      console.error(e);
      newspaperContainer.innerHTML = `<div class="error-message">エラーが発生しました: ${e.message}</div>`;
    }
  }

  function setupArticleSwapping() {
    const blocks = document.querySelectorAll('.sub-article-block');
    blocks.forEach(block => {
      let swapBtn = block.querySelector('.swap-btn');
      if (!swapBtn) {
        swapBtn = document.createElement('button');
        swapBtn.className = 'swap-btn';
        swapBtn.textContent = '🔄 差し替え';
        swapBtn.contentEditable = "false";
        swapBtn.style.display = 'none';
        block.insertBefore(swapBtn, block.firstChild);
        
        swapBtn.addEventListener('click', (e) => {
          if (!isEditing) return;
          e.preventDefault();
          e.stopPropagation();
          
          window.currentModalMode = 'swap';
          window.currentSwapBlock = block;
          
          showSwapModal();
        });
      }
      
      let delBtn = block.querySelector('.del-btn');
      if (!delBtn) {
        delBtn = document.createElement('button');
        delBtn.className = 'del-btn';
        delBtn.textContent = '🗑 削除';
        delBtn.contentEditable = "false";
        delBtn.style.display = 'none';
        block.insertBefore(delBtn, block.firstChild);
        
        delBtn.addEventListener('click', (e) => {
          if (!isEditing) return;
          e.preventDefault();
          e.stopPropagation();
          
          const oldId = block.getAttribute('data-id');
          const oldHeading = block.querySelector('.article-subheading')?.textContent || '元の記事';
          block.querySelector('.swap-btn')?.remove();
          block.querySelector('.del-btn')?.remove();
          window.spareArticles.push({
            id: oldId,
            html: block.innerHTML,
            heading: oldHeading
          });
          block.remove();
        });
      }
      
      if (isEditing) {
        swapBtn.style.display = 'inline-block';
        delBtn.style.display = 'inline-block';
      } else {
        swapBtn.style.display = 'none';
        delBtn.style.display = 'none';
      }
    });
    
    const articleBody = document.querySelector('.article-body');
    if (articleBody) {
      let addBtn = document.getElementById('add-article-btn');
      if (!addBtn) {
        addBtn = document.createElement('button');
        addBtn.id = 'add-article-btn';
        addBtn.className = 'add-btn no-print';
        addBtn.textContent = '＋ 空白を埋めるため記事を追加';
        addBtn.contentEditable = "false";
        articleBody.appendChild(addBtn);
        
        addBtn.addEventListener('click', (e) => {
          if (!isEditing) return;
          e.preventDefault();
          e.stopPropagation();
          
          window.currentModalMode = 'add';
          showSwapModal();
        });
      }
      
      if (isEditing) {
        addBtn.style.display = 'block';
      } else {
        addBtn.style.display = 'none';
      }
    }
    
    const closeBtn = document.querySelector('.close-btn');
    const newCloseBtn = closeBtn.cloneNode(true);
    if(closeBtn.parentNode) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    newCloseBtn.addEventListener('click', () => {
      document.getElementById('swap-modal').classList.add('hidden');
    });
  }

  function showSwapModal() {
    const modal = document.getElementById('swap-modal');
    const spareList = document.getElementById('spare-list');
    spareList.innerHTML = '';
    
    if (window.spareArticles.length === 0) {
       spareList.innerHTML = '<p>補欠記事がありません。</p>';
    } else {
       window.spareArticles.forEach(spare => {
         const div = document.createElement('div');
         div.className = 'spare-item';
         div.textContent = spare.heading;
         div.addEventListener('click', () => {
           applySpareArticle(spare);
           modal.classList.add('hidden');
         });
         spareList.appendChild(div);
       });
    }
    
    const generateDiv = document.createElement('div');
    generateDiv.className = 'spare-item';
    generateDiv.style.backgroundColor = '#e8f4fd';
    generateDiv.style.fontWeight = 'bold';
    generateDiv.textContent = '🤖 新しい記事をAIに生成させる';
    generateDiv.addEventListener('click', async () => {
       generateDiv.textContent = '⏳ 生成中...';
       const newArt = await generateExtraArticle();
       if (newArt) {
          applySpareArticle(newArt);
          modal.classList.add('hidden');
       } else {
          generateDiv.textContent = '🤖 新しい記事をAIに生成させる';
       }
    });
    spareList.appendChild(generateDiv);

    modal.classList.remove('hidden');
  }

  function applySpareArticle(spare) {
    if (window.currentModalMode === 'add') {
      const newBlock = document.createElement('div');
      newBlock.className = 'article-block sub-article-block editable';
      newBlock.setAttribute('data-id', spare.id);
      newBlock.innerHTML = spare.html;
      
      window.spareArticles = window.spareArticles.filter(s => s.id !== spare.id);
      
      const addBtnElem = document.getElementById('add-article-btn');
      document.querySelector('.article-body').insertBefore(newBlock, addBtnElem);
      setupArticleSwapping();
    } else if (window.currentModalMode === 'swap') {
      const block = window.currentSwapBlock;
      const oldId = block.getAttribute('data-id');
      const oldHeading = block.querySelector('.article-subheading')?.textContent || '元の記事';
      
      block.querySelector('.swap-btn')?.remove();
      block.querySelector('.del-btn')?.remove();
      const oldHtml = block.innerHTML;
      
      block.innerHTML = spare.html;
      block.setAttribute('data-id', spare.id);
      
      window.spareArticles = window.spareArticles.filter(s => s.id !== spare.id);
      // Put old one back to spare if it's not a newly generated one
      if (oldId) {
        window.spareArticles.push({ id: oldId, html: oldHtml, heading: oldHeading });
      }
      
      setupArticleSwapping();
    }
  }
  const editBtn = document.getElementById('edit-btn');
  let isEditing = false;

  editBtn.addEventListener('click', () => {
    if (newspaperContainer.querySelector('.article-header')) {
      isEditing = !isEditing;
      newspaperContainer.contentEditable = isEditing;
      
      const subBlocks = document.querySelectorAll('.sub-article-block');
      
      if (isEditing) {
        editBtn.textContent = '編集を完了する';
        editBtn.style.backgroundColor = '#e74c3c';
        newspaperContainer.style.outline = '3px dashed #3498db';
        newspaperContainer.style.padding = '47px 57px';
        subBlocks.forEach(b => b.classList.add('editable'));
      } else {
        editBtn.textContent = '記事を編集する';
        editBtn.style.backgroundColor = '';
        newspaperContainer.style.outline = 'none';
        newspaperContainer.style.padding = '50px 60px';
        subBlocks.forEach(b => b.classList.remove('editable'));
      }
      
      // Update swap buttons visibility
      setupArticleSwapping();
    } else {
      alert('まずは記事を生成してください。');
    }
  });


  async function generateExtraArticle() {
    if (!apiKey) {
      alert('Gemini APIキーを入力してください。');
      return null;
    }
    
    // Pick 3 random items to give context for a new sub article
    let allItems = [];
    for (const source of sources) {
       const items = await fetchRSS(source.url);
       allItems = allItems.concat(items.slice(0, 3));
    }
    allItems = allItems.sort(() => 0.5 - Math.random()).slice(0, 5);
    
    const newsContext = allItems.map((i, idx) => `[ニュース${idx+1}] タイトル: ${i.title}
概要: ${i.description.replace(/<[^>]+>/g, '')}`).join('\n\n');

    // Get current headings to avoid duplication
    const currentHeadings = Array.from(document.querySelectorAll('.article-subheading, .article-title')).map(el => el.textContent).join(' / ');

    const prompt = `
あなたは熱狂的なスポーツ新聞のベテラン記者です。以下のスポーツニュースを基に、新聞の空白を埋めるための「一口スポーツ記事（サブ記事）」を【1つだけ】作成してください。
文章は短めに、見出しをつけてください。

【重要な条件】
1. 必ずJSON形式で出力してください。Markdownのバッククォート \`\`\`json などは含めずに純粋なJSONテキストのみを出力してください。
2. 以下のようなJSON構造にしてください。
{
  "heading": "サブ記事の小見出し",
  "body": "サブ記事の本文HTML（段落<p>などを含む）"
}
3. 【最重要】現在紙面に載っている以下の記事内容と「同じ話題・重複する話題」は絶対に避けてください。別のニュースを選んでください。
現在の記事リスト: ${currentHeadings}

以下のニュースを基にしてください：
${newsContext}
    `;
    
    try {
      const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8 }
        })
      });

      const aiData = await apiResponse.json();
      if (aiData.error) throw new Error(aiData.error.message);

      let aiText = aiData.candidates[0].content.parts[0].text;
      aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(aiText);
      
      const subHtml = `
         <h2 class="article-subheading">${parsedData.heading}</h2>
         <p class="article-text">${parsedData.body}</p>
      `;
      
      return { id: Date.now(), heading: parsedData.heading, html: subHtml };
    } catch(e) {
      alert("追加生成に失敗しました: " + e.message);
      return null;
    }
  }

  generateBtn.addEventListener('click', generateArticle);

  printBtn.addEventListener('click', async () => {
    if (newspaperContainer.querySelector('.article-header')) {
      // Disable edit mode before printing
      if (isEditing) {
        editBtn.click();
      }
      
      const addBtn = document.getElementById('add-article-btn');
      if (addBtn) addBtn.style.display = 'none';
      
      const oldText = printBtn.textContent;
      printBtn.textContent = '⏳ 画像化して印刷...';
      printBtn.disabled = true;

      try {
        const layoutEl = document.querySelector('.newspaper-layout');
        const canvas = await html2canvas(layoutEl, { scale: 2, useCORS: true, logging: false });
        const imgUrl = canvas.toDataURL('image/png');
        
        let printImg = document.getElementById('print-overlay-img');
        if (!printImg) {
          printImg = document.createElement('img');
          printImg.id = 'print-overlay-img';
          document.body.appendChild(printImg);
        }
        printImg.src = imgUrl;
        
        document.body.classList.add('is-printing-image');
        
        setTimeout(() => {
           window.print();
           document.body.classList.remove('is-printing-image');
           printBtn.textContent = oldText;
           printBtn.disabled = false;
        }, 500);

      } catch (e) {
        console.error(e);
        alert('画像の生成に失敗しました。標準の印刷を使用します。');
        window.print();
        printBtn.textContent = oldText;
        printBtn.disabled = false;
      }

    } else {
      alert('まずは記事を生成してください。');
    }
  });

  renderSources();


});
