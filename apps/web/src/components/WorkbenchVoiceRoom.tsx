import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Activity,
  Layers,
  Wrench,
  CheckCircle,
  Clock,
  Sparkles,
  Server,
} from 'lucide-react';
import {
  useVoiceAssistant,
  BarVisualizer,
  RoomAudioRenderer,
  useLocalParticipant,
} from '@livekit/components-react';
import { toast } from 'sonner';
import { ModalConfirm } from './ModalConfirm';
import type { ErpMappingResponse, MetricsSnapshot } from '../types/assistant';

interface WorkbenchVoiceRoomProps {
  onDisconnect: () => void;
  erpMapping: ErpMappingResponse | null;
  metrics: MetricsSnapshot | null;
}

export const WorkbenchVoiceRoom: React.FC<WorkbenchVoiceRoomProps> = ({
  onDisconnect,
  erpMapping,
  metrics,
}) => {
  const { state, audioTrack, agent } = useVoiceAssistant();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [volume, setVolume] = useState(1);

  // Status do assistente
  const isAgentSpeaking = state === 'speaking';
  const isListening = state === 'listening';
  const isThinking = state === 'thinking';

  // Toggle do microfone
  const toggleMic = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      if (!isMicrophoneEnabled) {
        toast.success('Microfone ativado');
      } else {
        toast.info('Microfone silenciado');
      }
    } catch (err) {
      toast.error('Erro ao alternar microfone');
    }
  };

  const handleConfirmEndCall = () => {
    setShowEndCallModal(false);
    onDisconnect();
    toast.info('Conversa de bancada finalizada');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-7xl mx-auto p-4">
      {/* RENDERIZADOR DE ÁUDIO OBRIGATÓRIO PARA OUVIR O AGENTE */}
      <RoomAudioRenderer volume={volume} />

      {/* PAINEL CENTRAL DE VOZ (HANDS-FREE BANCADA) */}
      <div className="lg:col-span-8 flex flex-col gap-6">
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col items-center justify-between min-h-[460px]">
          {/* Efeito Glow Dinâmico de Fundo */}
          <div
            className={`absolute -top-32 -left-32 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none transition-all duration-700 ${
              isAgentSpeaking
                ? 'bg-emerald-500 scale-125'
                : isThinking
                ? 'bg-amber-500 scale-110'
                : 'bg-cyan-500 scale-100'
            }`}
          />

          {/* Cabeçalho do Agente */}
          <div className="w-full flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-tr from-cyan-500/20 to-emerald-500/20 border border-emerald-500/30 rounded-2xl">
                <Wrench className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-wide">
                  Operador de Bancada
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      state === 'speaking' || state === 'listening'
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-cyan-400 animate-ping'
                    }`}
                  />
                  <span className="text-xs uppercase font-medium tracking-wider text-slate-400">
                    Estado: {state}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 px-4 py-2 rounded-2xl">
              <Volume2 className="w-4 h-4 text-slate-400" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-20 accent-emerald-500 h-1.5 rounded-lg bg-slate-800 cursor-pointer"
                title="Volume do Assistente"
              />
            </div>
          </div>

          {/* Visualizador de Áudio e Indicador de Voz */}
          <div className="flex flex-col items-center justify-center my-8 z-10 w-full max-w-md">
            <div
              className={`w-40 h-40 rounded-full flex items-center justify-center border-4 transition-all duration-500 relative ${
                isAgentSpeaking
                  ? 'border-emerald-500/60 bg-emerald-500/10 shadow-[0_0_50px_rgba(16,185,129,0.3)] scale-105'
                  : isThinking
                  ? 'border-amber-500/60 bg-amber-500/10 shadow-[0_0_40px_rgba(245,158,11,0.2)] animate-pulse'
                  : 'border-slate-800 bg-slate-950/60'
              }`}
            >
              {audioTrack && (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <BarVisualizer
                    state={state}
                    barCount={7}
                    trackRef={audioTrack}
                    className="w-full h-24"
                  />
                </div>
              )}
              {!audioTrack && (
                <Activity
                  className={`w-14 h-14 ${
                    isAgentSpeaking
                      ? 'text-emerald-400 animate-bounce'
                      : isThinking
                      ? 'text-amber-400 animate-spin'
                      : 'text-slate-600'
                  }`}
                />
              )}
            </div>

            <div className="mt-6 text-center">
              <span
                className={`text-sm font-semibold tracking-wide px-4 py-1.5 rounded-full uppercase border ${
                  isAgentSpeaking
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : isThinking
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : isListening
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700'
                }`}
              >
                {isAgentSpeaking
                  ? 'Assistente falando...'
                  : isThinking
                  ? 'Processando intenção...'
                  : isListening
                  ? 'Ouvindo sua voz na bancada'
                  : 'Conectado e pronto'}
              </span>
              <p className="text-xs text-slate-400 mt-2">
                Você pode falar naturalmente a qualquer momento (suporta interrupção / barge-in)
              </p>
            </div>
          </div>

          {/* Barra de Controles Rápidos */}
          <div className="flex items-center gap-4 z-10 mt-auto pt-4 border-t border-slate-800/80 w-full justify-center">
            <button
              onClick={toggleMic}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-sm transition-all shadow-lg ${
                isMicrophoneEnabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  : 'bg-amber-600/30 text-amber-300 border border-amber-500/50 hover:bg-amber-600/40'
              }`}
            >
              {isMicrophoneEnabled ? (
                <>
                  <Mic className="w-5 h-5 text-emerald-400" />
                  Mudo
                </>
              ) : (
                <>
                  <MicOff className="w-5 h-5 text-amber-400" />
                  Ativar Mic
                </>
              )}
            </button>

            <button
              onClick={() => setShowEndCallModal(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-sm bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 transition shadow-lg shadow-red-950/50"
            >
              <PhoneOff className="w-5 h-5 text-red-400" />
              Encerrar Conversa
            </button>
          </div>
        </div>

        {/* GUIA RÁPIDO DE COMANDOS DE BANCADA */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Exemplos de Comandos por Voz para Experimentar
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
              <span className="font-semibold text-emerald-400 block mb-0.5">Consultas:</span>
              "Qual o status da OS 3030?" • "Tem óleo 5W30 em estoque?" • "Quais ordens estão abertas?"
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800">
              <span className="font-semibold text-cyan-400 block mb-0.5">Alterações (com confirmação):</span>
              "Altere o status da OS 3030 para concluído" • "Adicione 2 filtros de óleo na OS 3030"
            </div>
          </div>
        </div>
      </div>

      {/* PAINEL LATERAL: ORDENS NO ERP E MÉTRICAS */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        {/* Ordens de Exemplo no ERP Mock */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl shadow-xl flex flex-col flex-1">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold text-slate-100 text-sm">Ordens no ERP (Mock)</h3>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              {erpMapping?.sampleOrders.length ?? 0} registradas
            </span>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto max-h-[260px] pr-1">
            {erpMapping?.sampleOrders.map((os) => (
              <div
                key={os.numero_os}
                className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-2xl flex flex-col gap-1 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">OS #{os.numero_os}</span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
                      os.status === 'concluida'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : os.status === 'aguardando_pecas'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-cyan-500/20 text-cyan-400'
                    }`}
                  >
                    {os.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-xs text-slate-300 truncate">{os.cliente_nome}</div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 pt-1 border-t border-slate-900">
                  <span>{os.veiculo_equipamento || 'Equipamento'}</span>
                  <span className="font-semibold text-slate-200">
                    R$ {os.valor_total.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Métricas Operacionais */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Server className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Métricas da Sessão
              </h4>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Operações</span>
                <span className="text-base font-bold text-white">
                  {metrics?.totalOperations ?? 0}
                </span>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Confirmadas</span>
                <span className="text-base font-bold text-emerald-400">
                  {metrics?.confirmationsApproved ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ModalConfirm substituto de window.confirm() */}
      <ModalConfirm
        isOpen={showEndCallModal}
        title="Encerrar Conversa de Bancada?"
        message="Tem certeza que deseja desconectar o assistente de voz? As ordens e alterações salvas no ERP continuam preservadas."
        confirmText="Sim, Encerrar"
        cancelText="Voltar"
        onConfirm={handleConfirmEndCall}
        onCancel={() => setShowEndCallModal(false)}
        isDangerous
      />
    </div>
  );
};
