import { Modal } from '@/components/ui/modal';
import ImageEditor from '@/components/editor/ImageEditor';
import { ImageEditState } from '@/types';
import { useI18n } from '@/lib/i18n';

type EditorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (editState: ImageEditState) => void;
};

export default function EditorModal({ isOpen, onClose, imageUrl, onSave }: EditorModalProps) {
  const { t } = useI18n();
  const handleSave = (editState: ImageEditState) => {
    onSave(editState);
    onClose();
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      title="{t('app.imageEditor')}"
      size="lg"
    >
      <ImageEditor 
        imageUrl={imageUrl}
        onSave={handleSave}
        onCancel={onClose}
      />
    </Modal>
  );
}
