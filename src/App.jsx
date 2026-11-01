import React, { useState, useEffect } from 'react';
import {
  Download,
  Link2,
  ClipboardPaste,
  Sparkles,
  Settings,
  Globe,
  CheckCircle2,
  AlertCircle,
  Music,
  Film,
  Trash2,
  ExternalLink,
  Clock,
  ShieldCheck,
  Server,
  X,
  Loader2,
  Send,
  Youtube,
  Video,
  Bot,
} from 'lucide-react';
import { detectPlatform, PLATFORMS, SAMPLE_LINKS } from './utils/platformDetector';
import { fetchVideoInfo, loadApiSettings, saveApiSettings } from './services/videoApi';
import { TRANSLATIONS } from './data/translations';

const PLATFORM_META = {
  [PLATFORMS.ALL]: {
    name: 'Auto Detect',
    color: 'from-indigo-500 to-purple-500',
    badgeBg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  [PLATFORMS.TIKTOK]: {
    name: 'TikTok',
    color: 'from-pink-500 via-rose-500 to-cyan-400',
    badgeBg: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  },
  [PLATFORMS.YOUTUBE]: {
    name: 'YouTube',
    color: 'from-red-600 to-rose-500',
    badgeBg: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
  [PLATFORMS.TELEGRAM]: {
    name: 'Telegram',
    color: 'from-sky-500 to-blue-500',
    badgeBg: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
};

export default function App() {
  const [lang, setLang] = useState('mm');
  const t = TRANSLATIONS[lang];

  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState(PLATFORMS.ALL);
  const [quality, setQuality] = useState('1080');
  const [format, setFormat] = useState('mp4');
  const [removeWatermark, setRemoveWatermark] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('snapfetch_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showApiModal, setShowApiModal] = useState(false);
  const [apiSettings, setApiSettings] = useState(() => loadApiSettings());

  // Telegram Bot Setup Modal state
  const [showBotModal, setShowBotModal] = useState(false);
  const [botToken, setBotToken] = useState(() => localStorage.getItem('snapfetch_bot_token') || '');
  const [siteUrl, setSiteUrl] = useState(
    () => localStorage.getItem('snapfetch_site_url') || window.location.origin
  );
  const [botStatus, setBotStatus] = useState(null);
  const [botLoading, setBotLoading] = useState(false);

  const detected = detectPlatform(url);

  useEffect(() => {
    if (detected) {
      setActiveTab(detected);
    }
  }, [detected]);

  // Auto-resolve if opened from Telegram Bot link (?url=https://...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingUrl = params.get('url');
    if (incomingUrl) {
      setUrl(incomingUrl);
      handleSubmit(null, incomingUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        setError('');
      }
    } catch {
      setError(
        lang === 'mm'
          ? 'Clipboard ဖတ်ခွင့် မရပါ။ Link ကို ကိုယ်တိုင် Paste လုပ်ပေးပါ။'
          : 'Clipboard permission denied. Please paste manually.'
      );
    }
  };

  const handleSubmit = async (e, overrideUrl) => {
    if (e) e.preventDefault();
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) {
      setError(
        lang === 'mm'
          ? 'ကျေးဇူးပြု၍ Video Link တစ်ခု ထည့်ပေးပါ။'
          : 'Please enter a valid video URL.'
      );
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const info = await fetchVideoInfo(targetUrl, {
        quality,
        format,
        removeWatermark,
      });
      setResult(info);

      const newEntry = {
        id: Date.now(),
        title: info.title,
        author: info.author,
        platform: info.platform,
        thumbnail: info.thumbnail,
        sourceUrl: targetUrl,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [newEntry, ...history.filter((h) => h.sourceUrl !== targetUrl)].slice(0, 8);
      setHistory(updated);
      localStorage.setItem('snapfetch_history', JSON.stringify(updated));
    } catch (err) {
      setError(err.message || 'Failed to resolve video.');
    } finally {
      setLoading(false);
    }
  };

  const handleSampleClick = (platformKey) => {
    const sampleUrl = SAMPLE_LINKS[platformKey];
    setUrl(sampleUrl);
    setActiveTab(platformKey);
    handleSubmit(null, sampleUrl);
  };

  const triggerDownload = async (item, title) => {
    setDownloadingId(item.id);
    const safeName = (title || 'video').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
    const filename = `${safeName}.${item.ext.toLowerCase()}`;

    try {
      const streamProxyUrl = `/api/stream?url=${encodeURIComponent(item.url)}&filename=${encodeURIComponent(filename)}`;
      const headCheck = await fetch(streamProxyUrl, { method: 'HEAD' }).catch(() => null);

      if (headCheck && headCheck.ok) {
        const a = document.createElement('a');
        a.href = streamProxyUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      const response = await fetch(item.url);
      if (!response.ok) throw new Error('Direct fetch blocked by CORS');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadingId(null);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('snapfetch_history');
  };

  const handleSaveApiSettings = (e) => {
    e.preventDefault();
    saveApiSettings(apiSettings);
    setShowApiModal(false);
  };

  const handleConnectTelegramWebhook = async (e) => {
    e.preventDefault();
    if (!botToken.trim()) {
      setBotStatus({ ok: false, msg: 'ကျေးဇူးပြု၍ @BotFather ထံမှ ရရှိသော Bot Token ထည့်ပါ။' });
      return;
    }
    setBotLoading(true);
    setBotStatus(null);
    localStorage.setItem('snapfetch_bot_token', botToken.trim());
    localStorage.setItem('snapfetch_site_url', siteUrl.trim());

    try {
      const res = await fetch('/api/telegram-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setWebhook',
          botToken: botToken.trim(),
          siteUrl: siteUrl.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setBotStatus({
          ok: true,
          msg: `ချိတ်ဆက်မှု အောင်မြင်ပါသည်! @${data.botInfo?.username || 'Bot'} သို့ Link ပို့ပြီး စမ်းသပ်နိုင်ပါပြီ။`,
          webhookUrl: data.webhookUrl,
        });
      } else {
        setBotStatus({
          ok: false,
          msg: data.description || data.error || 'Webhook ချိတ်ဆက်ရာတွင် အမှားရှိနေပါသည်။',
        });
      }
    } catch (err) {
      setBotStatus({ ok: false, msg: err.message });
    } finally {
      setBotLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute -top-40 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute top-20 right-1/4 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-1/3 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight text-white">SnapFetch</span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v1.2
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBotModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-xs font-semibold text-sky-300 transition"
            >
              <Bot className="w-3.5 h-3.5 text-sky-400" />
              <span>Telegram Bot</span>
            </button>

            <button
              onClick={() => setLang(lang === 'mm' ? 'en' : 'mm')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 transition"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>{lang === 'mm' ? 'မြန်မာ / EN' : 'EN / မြန်မာ'}</span>
            </button>

            <button
              onClick={() => setShowApiModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 transition"
            >
              <Settings className="w-3.5 h-3.5 text-pink-400" />
              <span>{t.apiSettings}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.badge}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
            {t.heroTitle}{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-pink-400 to-sky-400 bg-clip-text text-transparent block mt-1">
              {t.heroHighlight}
            </span>
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-400 leading-relaxed">{t.heroSub}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          {[
            { id: PLATFORMS.ALL, label: 'All Platforms', icon: Video },
            { id: PLATFORMS.TIKTOK, label: 'TikTok', icon: Music },
            { id: PLATFORMS.YOUTUBE, label: 'YouTube', icon: Youtube },
            { id: PLATFORMS.TELEGRAM, label: 'Telegram', icon: Send },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                  isActive
                    ? `bg-gradient-to-r ${PLATFORM_META[tab.id].color} text-white shadow-lg shadow-indigo-500/20`
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="glass-card rounded-2xl p-5 sm:p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Link2 className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError('');
                  }}
                  placeholder={t.placeholder}
                  className="w-full pl-11 pr-24 py-3.5 bg-slate-900/95 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {url && (
                    <button
                      type="button"
                      onClick={() => {
                        setUrl('');
                        setResult(null);
                        setError('');
                      }}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t.pasteBtn}</span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:opacity-95 disabled:opacity-60 transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.fetchingBtn}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{t.fetchBtn}</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-slate-400">{t.formatLabel}:</span>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white"
                  >
                    <option value="mp4">MP4 (Video)</option>
                    <option value="mp3">MP3 / M4A (Audio Only)</option>
                  </select>
                </label>

                {format === 'mp4' && (
                  <label className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                    <span className="text-slate-400">{t.qualityLabel}:</span>
                    <select
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white"
                    >
                      <option value="1080">1080p Full HD</option>
                      <option value="720">720p HD</option>
                      <option value="360">360p Standard</option>
                    </select>
                  </label>
                )}

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={removeWatermark}
                    onChange={(e) => setRemoveWatermark(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-500"
                  />
                  <span>{t.noWatermark}</span>
                </label>
              </div>

              {detected && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">{t.detectedPlatform}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${PLATFORM_META[detected].badgeBg}`}
                  >
                    {PLATFORM_META[detected].name}
                  </span>
                </div>
              )}
            </div>
          </form>

          <div className="mt-4 pt-3 border-t border-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">{t.trySample}</span>
            <button
              type="button"
              onClick={() => handleSampleClick(PLATFORMS.TIKTOK)}
              className="px-2.5 py-1 rounded-md bg-pink-500/10 hover:bg-pink-500/20 text-pink-300 border border-pink-500/20 transition"
            >
              TikTok Sample
            </button>
            <button
              type="button"
              onClick={() => handleSampleClick(PLATFORMS.YOUTUBE)}
              className="px-2.5 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 transition"
            >
              YouTube Sample
            </button>
            <button
              type="button"
              onClick={() => handleSampleClick(PLATFORMS.TELEGRAM)}
              className="px-2.5 py-1 rounded-md bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 transition"
            >
              Telegram Sample
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-5 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {result && (
          <div className="mt-6 glass-card rounded-2xl p-5 sm:p-6 border border-indigo-500/30 shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-5 flex flex-col gap-3">
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-800 aspect-video">
                  {result.platform === PLATFORMS.YOUTUBE && result.embedUrl ? (
                    <iframe
                      src={result.embedUrl}
                      title={result.title}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : result.previewVideoUrl ? (
                    <video
                      src={result.previewVideoUrl}
                      poster={result.thumbnail}
                      controls
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={result.thumbnail}
                      alt={result.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <span
                    className={`absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border backdrop-blur-md pointer-events-none ${
                      PLATFORM_META[result.platform]?.badgeBg
                    }`}
                  >
                    {PLATFORM_META[result.platform]?.name}
                  </span>
                </div>

                <div>
                  <h2 className="font-bold text-base text-white line-clamp-2">{result.title}</h2>
                  <p className="text-xs text-slate-400 mt-1">{result.author}</p>
                  {result.stats && (
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                      <span>{result.stats.views}</span>
                      <span>•</span>
                      <span>{result.stats.likes}</span>
                      <span>•</span>
                      <span>{result.duration}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="md:col-span-7 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>{t.downloadOptions}</span>
                    </h3>
                    {result.isLiveResolved && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Live Stream Ready
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {result.formats.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300">
                            {item.ext}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white flex items-center gap-2">
                              <span>{item.label}</span>
                              {item.badge && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">{item.size}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => triggerDownload(item, result.title)}
                            disabled={downloadingId === item.id}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
                          >
                            {downloadingId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span>Download</span>
                          </button>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                            title="Open direct stream"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {result.note && (
                  <p className="mt-4 text-xs text-slate-400 bg-slate-900/70 p-3 rounded-lg border border-slate-800">
                    💡 {result.note}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Telegram Bot <=50MB / >50MB Banner */}
        <section className="mt-10 p-5 rounded-2xl bg-gradient-to-r from-sky-950/60 via-slate-900 to-indigo-950/50 border border-sky-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-sky-400" />
            </div>
            <div className="text-xs text-slate-300 space-y-1">
              <h3 className="font-bold text-sm text-white">
                Telegram Bot ချိတ်ဆက်မှု (≤ 50 MB Direct Video / &gt; 50 MB Download Link)
              </h3>
              <p className="text-slate-400">
                Bot ဆီသို့ Link ပို့လိုက်ရုံဖြင့် <strong>50 MB အောက်</strong> ဆိုလျှင် Video ဖိုင်တိုက်ရိုက် ပို့ပေးပြီး၊{' '}
                <strong>50 MB အထက်</strong> ဆိုလျှင် Direct Download Link နှင့် ဤ Website Link ကို ပြန်ပို့ပေးပါသည်။
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowBotModal(true)}
            className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shrink-0 transition"
          >
            Bot ချိတ်ဆက်ရန်
          </button>
        </section>

        {history.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span>{t.historyTitle}</span>
              </h2>
              <button
                onClick={clearHistory}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.clearHistory}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setUrl(item.sourceUrl);
                    handleSubmit(null, item.sourceUrl);
                  }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 cursor-pointer transition"
                >
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-16 h-12 rounded-lg object-cover shrink-0 bg-slate-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                      <span className="capitalize text-indigo-300">{item.platform}</span>
                      <span>•</span>
                      <span>{item.timestamp}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-14">
          <h2 className="text-lg font-bold text-white text-center mb-6">{t.featuresTitle}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {t.features.map((feat, idx) => (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/90 hover:border-slate-700 transition"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mb-3 text-indigo-400 font-bold text-sm">
                  0{idx + 1}
                </div>
                <h3 className="font-semibold text-sm text-white mb-1.5">{feat.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 p-5 rounded-2xl bg-gradient-to-r from-indigo-950/50 via-slate-900 to-pink-950/40 border border-indigo-500/20">
          <div className="flex items-start gap-3">
            <Server className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 space-y-1.5">
              <h3 className="font-semibold text-sm text-white">{t.netlifyGuideTitle}</h3>
              <p>
                1. <strong>GitHub + Netlify Auto Deploy</strong>: သင်၏ GitHub repository (
                <code className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300">
                  htoohtethtet331-cpu/download-Proj
                </code>
                ) ကို Netlify နှင့် ချိတ်ဆက်လိုက်ပါက YouTube/TikTok/Telegram Resolver နှင့် Telegram Bot Webhook တို့ အလိုအလျောက် အလုပ်လုပ်ပေးပါမည်။
              </p>
              <p>
                2. <strong>Telegram Bot Environment Variable</strong>: Netlify Site Settings → Environment Variables တွင်{' '}
                <code className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                  TELEGRAM_BOT_TOKEN
                </code>{' '}
                ထည့်သွင်းနိုင်သလို အပေါ်ရှိ <strong>Telegram Bot</strong> ခလုတ်မှလည်း တိုက်ရိုက် ချိတ်ဆက်နိုင်ပါသည်။
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Telegram Bot Setup Modal */}
      {showBotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base text-white">
                  Telegram Bot ချိတ်ဆက်ရန် (≤ 50MB Video / &gt; 50MB Link)
                </h3>
              </div>
              <button
                onClick={() => setShowBotModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="font-semibold text-sky-300">အလုပ်လုပ်ပုံ (Bot Workflow):</div>
                <p>
                  • User က Bot ဆီသို့ TikTok / YouTube / Telegram link ပို့လိုက်သည့်အခါ File Size ကို အလိုအလျောက် စစ်ဆေးပေးပါသည်။
                </p>
                <p>
                  • <strong>≤ 50 MB (50 MB အောက်)</strong>: Video ဖိုင်ကို Telegram Chat ထဲသို့ တိုက်ရိုက်ပို့ပေးပြီး Website link ပါ ထည့်ပေးပါသည်။
                </p>
                <p>
                  • <strong>&gt; 50 MB (50 MB အထက်)</strong>: Direct Download ဆွဲရန် Link ခလုတ်နှင့် Website ပေါ်တွင် အလိုအလျောက် ပွင့်လာမည့် Link (
                  <code className="text-indigo-300">/?url=...</code>) ကို ပြန်ပို့ပေးပါသည်။
                </p>
              </div>

              <form onSubmit={handleConnectTelegramWebhook} className="space-y-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    1. Telegram Bot Token (@BotFather မှ ရယူရန်)
                  </label>
                  <input
                    type="text"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456789:AAH_your_telegram_bot_token..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    2. သင်၏ Netlify Website URL (Production URL)
                  </label>
                  <input
                    type="url"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    placeholder="https://your-site-name.netlify.app"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                {botStatus && (
                  <div
                    className={`p-3 rounded-xl border ${
                      botStatus.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : 'bg-red-500/10 border-red-500/30 text-red-200'
                    }`}
                  >
                    {botStatus.msg}
                  </div>
                )}

                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400">
                  💻 <strong>Local တွင် စမ်းသပ်လိုပါက</strong> Terminal တွင် အောက်ပါ command ဖြင့် Bot ကို တိုက်ရိုက် Run နိုင်ပါသည် —
                  <code className="block mt-1.5 p-2 rounded bg-slate-900 text-sky-300 select-all">
                    TELEGRAM_BOT_TOKEN="{botToken || 'YOUR_BOT_TOKEN'}" npm run bot
                  </code>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowBotModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={botLoading}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center gap-1.5"
                  >
                    {botLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Connect Netlify Webhook</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* API Configuration Modal */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base text-white">API Backend Configuration</h3>
              </div>
              <button
                onClick={() => setShowApiModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveApiSettings} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Resolver Mode</label>
                <select
                  value={apiSettings.mode}
                  onChange={(e) => setApiSettings({ ...apiSettings, mode: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
                >
                  <option value="auto">
                    Auto (Built-in YouTube InnerTube + TikWM + Telegram Resolver)
                  </option>
                  <option value="custom">Custom Backend / Cobalt API URL</option>
                </select>
              </div>

              {apiSettings.mode === 'custom' && (
                <>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Backend / Cobalt API Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={apiSettings.customEndpoint}
                      onChange={(e) =>
                        setApiSettings({ ...apiSettings, customEndpoint: e.target.value })
                      }
                      placeholder="https://your-api.example.com/api/json"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      API Key / Bearer Token (Optional)
                    </label>
                    <input
                      type="password"
                      value={apiSettings.apiKey}
                      onChange={(e) => setApiSettings({ ...apiSettings, apiKey: e.target.value })}
                      placeholder="Bearer or RapidAPI key..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowApiModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
                >
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
