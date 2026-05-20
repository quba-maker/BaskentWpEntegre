import React, { useState } from 'react';
import { usePipelineStream } from './hooks/usePipelineStream';
import { usePipelineStore } from './store/pipelineStore';
import { BrainCircuit, Loader2, CheckCircle2, AlertTriangle, PlayCircle, ShieldAlert, Activity, StopCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function LivePipelineView() {
  const [isStarted, setIsStarted] = useState(false);
  
  // Conditionally hook up the stream only when started
  // To avoid breaking React rules of hooks, we'll mount a child component
  return (
    <div className="bg-white border border-gray-200 rounded-[24px] p-6 shadow-sm overflow-hidden relative">
      {!isStarted ? (
        <div className="text-center py-10">
          <BrainCircuit className="w-16 h-16 text-purple-200 mx-auto mb-4" />
          <h3 className="text-[18px] font-bold text-[var(--q-text-primary)] mb-2">Ready for Neural Sync</h3>
          <p className="text-[13px] text-gray-500 mb-8 max-w-sm mx-auto">
            This will trigger a real end-to-end SSE data pipeline using the AI Orchestrator. 
          </p>
          <button 
            onClick={() => setIsStarted(true)}
            className="flex items-center gap-2 px-8 py-3 bg-[var(--q-text-primary)] text-white text-[14px] font-bold rounded-xl hover:bg-black transition-all mx-auto shadow-[0_4px_14px_0_rgba(0,0,0,0.1)]"
          >
            <PlayCircle className="w-5 h-5" /> Start Neural Sync
          </button>
        </div>
      ) : (
        <ActiveStream />
      )}
    </div>
  );
}

function ActiveStream() {
  const { stopStream } = usePipelineStream('review_needed'); // Force scenario that requires human review
  const { events, currentState, isConnected, reviewSession, resetPipeline } = usePipelineStore();

  const handleStop = () => {
    stopStream();
    resetPipeline();
  };

  return (
    <div className="flex flex-col h-full min-h-[300px]">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            {isConnected && currentState !== 'completed' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? (currentState === 'completed' ? 'bg-green-500' : 'bg-purple-500') : 'bg-gray-300'}`}></span>
          </div>
          <h4 className="text-[15px] font-bold text-gray-800 flex items-center gap-2">
            Pipeline Orchestrator 
            <span className="text-[10px] uppercase bg-gray-100 px-2 py-0.5 rounded text-gray-500">Live SSE</span>
          </h4>
        </div>
        <button onClick={handleStop} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors">
          <StopCircle className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-2 max-h-[300px]">
        <AnimatePresence>
          {events.map((evt, idx) => (
            <EventItem key={evt.eventId || idx} evt={evt} />
          ))}
        </AnimatePresence>

        {reviewSession.required && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="p-4 bg-amber-50 border-2 border-amber-200 rounded-xl mt-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h5 className="font-bold text-amber-900">Human Review Required</h5>
            </div>
            <p className="text-[12px] text-amber-700 font-medium mb-4">
              AI Reason: {reviewSession.reason}
            </p>
            <button className="w-full py-2 bg-amber-500 text-white text-[13px] font-bold rounded-lg hover:bg-amber-600">
              Resolve Conflict Manually
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

const EventItem = React.memo(({ evt }: { evt: any }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-start gap-4 p-3 bg-gray-50/50 rounded-xl border border-gray-100"
    >
      <div className="mt-0.5 flex-shrink-0">
        {evt.type.includes('started') && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
        {evt.type.includes('completed') && <CheckCircle2 className="w-4 h-4 text-green-500" />}
        {evt.type.includes('required') && <ShieldAlert className="w-4 h-4 text-amber-500" />}
        {evt.type.includes('progress') && <Activity className="w-4 h-4 text-purple-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-gray-800">
          {evt.type.split('.').slice(1).join(' ').toUpperCase()}
        </p>
        {'payload' in evt && evt.payload && (
          <pre className="text-[10px] text-gray-500 mt-1 bg-white p-2 border border-gray-100 rounded-lg overflow-x-auto whitespace-pre-wrap break-words max-h-[150px]">
            {JSON.stringify(evt.payload, null, 2)}
          </pre>
        )}
      </div>
      <div className="text-[10px] text-gray-400 font-mono whitespace-nowrap">
        {new Date(evt.timestamp).toLocaleTimeString()}
      </div>
    </motion.div>
  );
});
