"use client";

import { useMemo } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { DealCard, type DealCardData } from "./DealCard";
import { formatCurrency, uniq } from "./tokens";

export interface KanbanStage {
  id: string;
  name: string;
  order: number;
  color?: string;
  probability?: number;
  is_won?: boolean;
  is_lost?: boolean;
}

export interface KanbanStageStats {
  stage_id: string;
  count: number;
  value_sum: number;
}

export interface KanbanBoardProps {
  stages: KanbanStage[];
  deals: DealCardData[];
  stats?: KanbanStageStats[];
  currency?: string;
  stageOf: (deal: DealCardData) => string; // returns stage_id of a deal
  onMove: (dealId: string, destStageId: string, srcStageId: string) => void;
  isLoading?: boolean;
}

// KanbanBoard — column per stage, draggable deals. Keeps the Uniq.chat dark
// aesthetic (HSL panels, green accent). Stats in each column header show
// count + value sum (Pipedrive-style).
export function KanbanBoard({ stages, deals, stats, currency = "BRL", stageOf, onMove, isLoading }: KanbanBoardProps) {
  const dealsByStage = useMemo(() => {
    const map: Record<string, DealCardData[]> = {};
    stages.forEach((s) => (map[s.id] = []));
    deals.forEach((d) => {
      const sid = stageOf(d);
      if (!map[sid]) map[sid] = [];
      map[sid].push(d);
    });
    return map;
  }, [deals, stages, stageOf]);

  const statsById = useMemo(() => {
    const m: Record<string, KanbanStageStats> = {};
    (stats ?? []).forEach((s) => (m[s.stage_id] = s));
    return m;
  }, [stats]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages]
  );

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.droppableId === result.source.droppableId) return;
    onMove(result.draggableId, result.destination.droppableId, result.source.droppableId);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto px-1 pb-2">
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage[stage.id] ?? [];
          const stat = statsById[stage.id];
          const totalValue = stat?.value_sum ?? stageDeals.reduce((sum, d) => sum + d.value, 0);
          const count = stat?.count ?? stageDeals.length;

          return (
            <div
              key={stage.id}
              className="flex h-full w-72 flex-shrink-0 flex-col rounded-xl"
              style={{ background: uniq.panel, border: `1px solid ${uniq.borderFaint}` }}
            >
              <StageHeader stage={stage} count={count} totalValue={totalValue} currency={currency} />
              <Droppable droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex-1 space-y-2 overflow-y-auto px-2 pb-3 pt-1 transition-colors"
                    style={{
                      background: snapshot.isDraggingOver ? "rgba(0,212,106,0.04)" : undefined,
                      minHeight: 80,
                    }}
                  >
                    {isLoading && stageDeals.length === 0 && (
                      <SkeletonCard />
                    )}
                    {!isLoading && stageDeals.length === 0 && (
                      <div
                        className="rounded-md border border-dashed py-6 text-center text-[11px]"
                        style={{ borderColor: uniq.borderFaint, color: uniq.textFaint }}
                      >
                        Sem deals
                      </div>
                    )}
                    {stageDeals.map((deal, idx) => (
                      <Draggable key={deal.id} draggableId={deal.id} index={idx}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            style={prov.draggableProps.style}
                          >
                            <DealCard deal={deal} isDragging={snap.isDragging} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}

function StageHeader({
  stage, count, totalValue, currency,
}: {
  stage: KanbanStage;
  count: number;
  totalValue: number;
  currency: string;
}) {
  const stripe =
    stage.is_won ? uniq.statusWon
    : stage.is_lost ? uniq.statusLost
    : stage.color && stage.color.length > 1 ? stage.color
    : uniq.green;

  return (
    <div
      className="flex items-center justify-between rounded-t-xl px-3 py-2"
      style={{
        borderBottom: `1px solid ${uniq.borderFaint}`,
        boxShadow: `inset 3px 0 0 ${stripe}`,
      }}
    >
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold" style={{ color: uniq.textPrimary }}>
            {stage.name}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "rgba(255,255,255,0.05)", color: uniq.textDim }}
          >
            {count}
          </span>
          {stage.is_won && <span className="text-[10px]" style={{ color: uniq.statusWon }}>✓</span>}
          {stage.is_lost && <span className="text-[10px]" style={{ color: uniq.statusLost }}>✕</span>}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: uniq.textFaint }}>
          {formatCurrency(totalValue, currency)}
          {stage.probability ? ` · ${stage.probability}%` : ""}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="h-24 animate-pulse rounded-xl"
      style={{ background: "rgba(255,255,255,0.04)" }}
    />
  );
}
