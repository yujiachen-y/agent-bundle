from __future__ import annotations


def chat_page_html(default_model: str) -> str:
    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>Agent Bundle Chat</title>
  <style>
    :root {{
      --bg: #f6f8fb;
      --card: #ffffff;
      --text: #102a43;
      --muted: #5c6b7a;
      --accent: #0b7285;
      --border: #dde4ed;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; background: radial-gradient(circle at 20% 10%, #eef6ff 0%, var(--bg) 35%, #eaf5f0 100%); color: var(--text); }}
    .wrap {{ max-width: 900px; margin: 24px auto; padding: 0 16px; }}
    .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 10px 30px rgba(16, 42, 67, 0.08); overflow: hidden; }}
    .header {{ padding: 16px 18px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }}
    .title {{ font-weight: 700; letter-spacing: .2px; }}
    .model {{ color: var(--muted); font-size: 13px; }}
    #chat {{ padding: 14px 18px; min-height: 420px; max-height: 65vh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }}
    .msg {{ padding: 11px 12px; border-radius: 10px; max-width: 88%; white-space: pre-wrap; line-height: 1.4; }}
    .user {{ align-self: flex-end; background: #e0f4f7; border: 1px solid #bee4ea; }}
    .assistant {{ align-self: flex-start; background: #f8fbff; border: 1px solid #d8e3f0; }}
    .composer {{ border-top: 1px solid var(--border); padding: 12px; display: grid; grid-template-columns: 1fr auto; gap: 10px; }}
    textarea {{ width: 100%; resize: vertical; min-height: 56px; padding: 10px; border-radius: 10px; border: 1px solid #c8d4e3; font: inherit; }}
    button {{ border: 0; border-radius: 10px; background: var(--accent); color: #fff; padding: 0 14px; min-width: 100px; font-weight: 600; cursor: pointer; }}
    button:disabled {{ opacity: .6; cursor: wait; }}
  </style>
</head>
<body>
  <div class=\"wrap\">
    <div class=\"card\">
      <div class=\"header\">
        <div class=\"title\">Agent Bundle Local Chat</div>
        <div class=\"model\">model: {default_model}</div>
      </div>
      <div id=\"chat\"></div>
      <div class=\"composer\">
        <textarea id=\"input\" placeholder=\"Ask anything...\"></textarea>
        <button id=\"send\">Send</button>
      </div>
    </div>
  </div>
<script>
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const messages = [];

  function push(role, content) {{
    messages.push({{ role, content }});
    const row = document.createElement('div');
    row.className = `msg ${{role}}`;
    row.textContent = content;
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
  }}

  async function onSend() {{
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    push('user', value);
    send.disabled = true;

    try {{
      const res = await fetch('/v1/chat/completions', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ model: '{default_model}', messages }})
      }});
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '[empty response]';
      push('assistant', content);
    }} catch (err) {{
      push('assistant', 'Request failed: ' + String(err));
    }} finally {{
      send.disabled = false;
      input.focus();
    }}
  }}

  send.addEventListener('click', onSend);
  input.addEventListener('keydown', (e) => {{
    if (e.key === 'Enter' && !e.shiftKey) {{
      e.preventDefault();
      onSend();
    }}
  }});
</script>
</body>
</html>"""
