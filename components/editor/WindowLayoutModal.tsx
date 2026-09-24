'use client';

import { type CSSProperties, type FC } from 'react';
import { Modal } from '@/components/ui/modal';
import { useI18n } from '@/lib/i18n';

/** Composición de ventanas del área de trabajo. */
export type WindowLayout =
  | 'grid4'
  | 'twoH'
  | 'twoV'
  | 'threeLeft'
  | 'threeRight'
  | 'threeOne'
  | 'threeOneRight';

interface WindowLayoutModalProps {
  isOpen: boolean;
  current: WindowLayout;
  onSelect: (layout: WindowLayout) => void;
  onClose: () => void;
}

/** Composiciones ofrecidas, en orden de aparición. */
const LAYOUT_IDS: { id: WindowLayout; labelKey: string }[] = [
  { id: 'grid4', labelKey: 'editor3D.windowLayout.grid4' },
  { id: 'twoH', labelKey: 'editor3D.windowLayout.twoH' },
  { id: 'twoV', labelKey: 'editor3D.windowLayout.twoV' },
  { id: 'threeLeft', labelKey: 'editor3D.windowLayout.threeLeft' },
  { id: 'threeRight', labelKey: 'editor3D.windowLayout.threeRight' },
  { id: 'threeOne', labelKey: 'editor3D.windowLayout.threeOne' },
  { id: 'threeOneRight', labelKey: 'editor3D.windowLayout.threeOneRight' },
];

const GAP = 3;

/** Una celda (ventana) del boceto. */
const Cell: FC<{ style?: CSSProperties }> = ({ style }) => (
  <div className="rounded-[3px] bg-green-500/25 border border-green-400/40" style={style} />
);

/** Boceto en miniatura de una composición de ventanas. */
function LayoutPreview({ layout }: { layout: WindowLayout }) {
  const row: CSSProperties = { display: 'flex', gap: GAP, width: '100%', height: '100%' };
  const col: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: GAP,
    width: '100%',
    height: '100%',
  };
  switch (layout) {
    case 'grid4':
      return (
        <div
          style={{
            ...row,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
          }}
        >
          <Cell />
          <Cell />
          <Cell />
          <Cell />
        </div>
      );
    case 'twoH':
      return (
        <div style={row}>
          <Cell style={{ flex: 1 }} />
          <Cell style={{ flex: 1 }} />
        </div>
      );
    case 'twoV':
      return (
        <div style={col}>
          <Cell style={{ flex: 1 }} />
          <Cell style={{ flex: 1 }} />
        </div>
      );
    case 'threeLeft':
      return (
        <div style={row}>
          <div style={{ ...col, flex: 1 }}>
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
          </div>
          <Cell style={{ flex: 1 }} />
        </div>
      );
    case 'threeRight':
      return (
        <div style={row}>
          <Cell style={{ flex: 1 }} />
          <div style={{ ...col, flex: 1 }}>
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
          </div>
        </div>
      );
    case 'threeOne':
      return (
        <div style={row}>
          <div style={{ ...col, flex: 1 }}>
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
          </div>
          <div style={{ ...col, flex: 2 }}>
            <Cell style={{ flex: 1 }} />
          </div>
        </div>
      );
    case 'threeOneRight':
      return (
        <div style={row}>
          <div style={{ ...col, flex: 2 }}>
            <Cell style={{ flex: 1 }} />
          </div>
          <div style={{ ...col, flex: 1 }}>
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
            <Cell style={{ flex: 1 }} />
          </div>
        </div>
      );
  }
}

/**
 * Modal con las composiciones de ventanas del área de trabajo (1 a 4 visores
 * repartidos de varias formas). Al elegir una se aplica al instante.
 */
const WindowLayoutModal: FC<WindowLayoutModalProps> = ({
  isOpen,
  current,
  onSelect,
  onClose,
}) => {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('editor3D.windowLayout.title')}
      description={t('editor3D.windowLayout.desc')}
      size="2xl"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {LAYOUT_IDS.map(({ id, labelKey }) => {
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`window-layout-${id}`}
              onClick={() => {
                onSelect(id);
                onClose();
              }}
              className={`group flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                active
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-white/10 bg-white/5 hover:border-green-400/60 hover:bg-white/10'
              }`}
            >
              <div className="h-[84px] w-full rounded-md bg-black/40 p-2">
                <LayoutPreview layout={id} />
              </div>
              <span
                className={`text-[12px] font-medium ${
                  active ? 'text-green-300' : 'text-foreground/90'
                }`}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
};

export default WindowLayoutModal;
