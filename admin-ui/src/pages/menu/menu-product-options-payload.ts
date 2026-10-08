import { builderOptionSections, optionLanguages } from './menu-page.shared';

export function productOptionsPayload(optionsDraft: any) {
  const configuration = { ...optionsDraft.configuration };
  for (const section of builderOptionSections) {
    configuration[section.key] = (configuration[section.key] || []).map(
      (option: any, index: number) => {
        const title = {
          ru: String(option.title?.ru || option.name || '').trim(),
          kk: String(option.title?.kk || '').trim(),
          en: String(option.title?.en || '').trim(),
        };
        const priceDelta = Number(option.priceDelta || 0);
        const missingLanguage = optionLanguages.find(({ code }) => !title[code]);
        if (missingLanguage) {
          throw new Error(
            `Заполните ${missingLanguage.label}: «${section.title}», строка ${index + 1}`,
          );
        }
        if (!Number.isFinite(priceDelta) || priceDelta < 0) {
          throw new Error(`Некорректная доплата: «${section.title}», строка ${index + 1}`);
        }
        return {
          ...option,
          code: option.code || `${section.prefix}_${index + 1}`,
          title,
          priceDelta,
        };
      },
    );
  }

  const modifierGroups = optionsDraft.modifierGroups.map((group: any, index: number) => {
    const groupTitle = {
      ru: String(group.title?.ru || group.name || '').trim(),
      kk: String(group.title?.kk || '').trim(),
      en: String(group.title?.en || '').trim(),
    };
    const missingGroupLanguage = optionLanguages.find(({ code }) => !groupTitle[code]);
    if (missingGroupLanguage) {
      throw new Error(`Заполните ${missingGroupLanguage.label} для группы №${index + 1}`);
    }
    const groupName = groupTitle.ru;
    if (!(group.options || []).length) {
      throw new Error(`Добавьте хотя бы один вариант в группу «${groupName}»`);
    }
    const options = group.options.map((option: any, optionIndex: number) => {
      const optionTitle = {
        ru: String(option.title?.ru || option.name || '').trim(),
        kk: String(option.title?.kk || '').trim(),
        en: String(option.title?.en || '').trim(),
      };
      const missingOptionLanguage = optionLanguages.find(({ code }) => !optionTitle[code]);
      const priceDelta = Number(option.priceDelta || 0);
      if (missingOptionLanguage) {
        throw new Error(
          `Заполните ${missingOptionLanguage.label} для варианта №${optionIndex + 1} в группе «${groupName}»`,
        );
      }
      const optionName = optionTitle.ru;
      if (!Number.isFinite(priceDelta) || priceDelta < 0) {
        throw new Error(`Некорректная доплата у «${optionName}»`);
      }
      return {
        ...option,
        code: option.code || `option_${optionIndex + 1}`,
        title: optionTitle,
        priceDelta,
      };
    });
    const selectionType = group.selectionType === 'multiple' ? 'multiple' : 'single';
    const maxSelected =
      selectionType === 'single'
        ? 1
        : Math.min(options.length, Math.max(1, Number(group.maxSelected || 1)));
    const minSelected = group.required
      ? Math.max(1, Number(group.minSelected || 1))
      : Math.max(0, Number(group.minSelected || 0));
    if (minSelected > maxSelected) {
      throw new Error(`В группе «${groupName}» минимум не может быть больше максимума`);
    }
    return {
      ...group,
      code: group.code || `group_${index + 1}`,
      title: groupTitle,
      selectionType,
      minSelected,
      maxSelected,
      options,
    };
  });
  return { configuration, modifierGroups };
}
