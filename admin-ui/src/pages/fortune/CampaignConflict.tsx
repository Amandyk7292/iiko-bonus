import type { mergeCampaign } from './merge-campaign';
import type { Text } from './model';

export default function CampaignConflict({
  conflict,
  text,
  onResolve,
}: {
  conflict: ReturnType<typeof mergeCampaign>;
  text: Text;
  onResolve: (choice: 'mine' | 'theirs') => void;
}) {
  return (
    <div className="fortune-conflict" role="alert">
      <p>{text('Выберите, какие изменения оставить.', 'Қай өзгерістерді қалдыруды таңдаңыз.')}</p>
      <div className="fortune-conflict-values">
        <table>
          <thead>
            <tr>
              <th>{text('Настройка', 'Баптау')}</th>
              <th>{text('Моя правка', 'Менің түзетуім')}</th>
              <th>{text('Новое значение', 'Жаңа мән')}</th>
            </tr>
          </thead>
          <tbody>
            {conflict.details?.map((change) => (
              <tr key={change.label}>
                <th scope="row">{change.label}</th>
                <td>{change.mine}</td>
                <td>{change.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fortune-actions">
        <button type="button" className="btn-outline" onClick={() => onResolve('theirs')}>
          {text('Принять новые значения', 'Жаңа мәндерді қабылдау')}
        </button>
        <button type="button" className="btn-primary" onClick={() => onResolve('mine')}>
          {text('Оставить мои правки', 'Өз түзетулерімді қалдыру')}
        </button>
      </div>
    </div>
  );
}
