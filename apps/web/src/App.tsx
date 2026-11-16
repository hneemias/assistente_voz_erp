import React, { useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react';
import {
  Mic,
  Activity,
  Layers,
  Wrench,
  Sparkles,
  Server,
  Radio,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useBackendStatus } from './hooks/useBackendStatus';
import { requestLiveKitToken } from './services/api';
import { WorkbenchVoiceRoom } from './components/WorkbenchVoiceRoom';

export const App: React.FC = () => {
  const { health, metrics, erpMapping, backendOffline } = useBackendStatus();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [participantName, setParticipantName] = useState('Operador Bancada 01');
  const [roomName, setRoomName] = useState('bancada-oficina-01');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participantName.trim()) {
      toast.error('Informe o nome ou identificação do operador');
      return;
    }

    setIsConnecting(true);
    try {
      const data = await requestLiveKitToken({
        participantName,
        roomName,
      });
      setServerUrl(data.serverUrl);
      setToken(data.token);
      toast.success('Conectando à sala LiveKit...');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Falha ao solicitar token LiveKit do servidor',
      );
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setToken(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30">
      {/* Toast Notifications (substituto obrigatório do alert()) */}
      <Toaster position="top-right" richColors theme="dark" />

      {/* CABEÇALHO SUPERIOR */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
              <Radio className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Inovar ERP <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">Voz de Bancada</span>
              </h1>
              <p className="text-xs text-slate-400">
                Assistente LiveKit Agents integrado às APIs REST do ERP
              </p>
            </div>
          </div>

          {/* Status do Backend & LiveKit */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
              <span
                className={`w-2 h-2 rounded-full ${
                  backendOffline ? 'bg-red-500' : 'bg-emerald-400 animate-pulse'
                }`}
              />
              <span className="text-slate-300 font-medium">
                {backendOffline ? 'Backend Offline' : `ERP Mode: ${health?.erp.mode ?? 'mock'}`}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
              <span>LLM:</span>
              <span className="text-slate-200 font-medium">{health?.aiProviders.llmModel ?? 'Gemini'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {token ? (
          <LiveKitRoom
            serverUrl={serverUrl}
            token={token}
            connect={true}
            audio={true}
            video={false}
            onDisconnected={handleDisconnect}
            className="w-full"
          >
            <WorkbenchVoiceRoom
              onDisconnect={handleDisconnect}
              erpMapping={erpMapping}
              metrics={metrics}
            />
          </LiveKitRoom>
        ) : (
          /* TELA INICIAL DE CONEXÃO À BANCADA */
          <div className="w-full max-w-xl mx-auto flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden text-center">
              <div className="w-20 h-20 mx-auto rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 shadow-inner">
                <Mic className="w-10 h-10" />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">
                Conectar Assistente de Voz
              </h2>
              <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
                Opere ordens de serviço, consulte produtos e faça alterações no ERP usando apenas a sua voz enquanto trabalha na bancada.
              </p>

              <form onSubmit={handleConnect} className="flex flex-col gap-4 text-left">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5 uppercase tracking-wider">
                    Identificação do Operador
                  </label>
                  <input
                    type="text"
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition"
                    placeholder="Ex: Operador Bancada 01"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5 uppercase tracking-wider">
                    Nome da Estação / Sala LiveKit
                  </label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition"
                    placeholder="Ex: bancada-oficina-01"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isConnecting}
                  className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-semibold py-3.5 px-6 rounded-2xl transition duration-200 shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Conectando...
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      Iniciar Atendimento por Voz
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* STATUS E MAPEAMENTO ERP */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 text-xs text-slate-300 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold text-white block">
                    Modo Seguro de Demonstração (MOCK) Ativo
                  </span>
                  <span className="text-slate-400">
                    O assistente responde com dados simulados realistas de OS 3030, 3031, 4040 e catálogo.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RODAPÉ */}
      <footer className="border-t border-slate-900 py-3 text-center text-xs text-slate-500">
        Inovar ERP — Camada de Voz Inteligente LiveKit Agents SDK
      </footer>
    </div>
  );
};

export default App;
