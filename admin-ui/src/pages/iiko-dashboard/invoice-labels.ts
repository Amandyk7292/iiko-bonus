const labels: Record<string, [string, string, string]> = {
  invoices: ['Накладные', 'Жүкқұжаттар', 'Invoices'],
  suppliers: ['Поставщики', 'Жеткізушілер', 'Suppliers'],
  productLines: ['Товарных позиций', 'Тауар позициялары', 'Product lines'],
  total: ['Сумма приходов', 'Кіріс сомасы', 'Received total'],
  supplierFilter: ['Поставщик', 'Жеткізуші', 'Supplier'],
  allSuppliers: ['Все поставщики', 'Барлық жеткізушілер', 'All suppliers'],
  noSupplierData: ['нет данных за выбранный период', 'таңдалған кезеңде деректер жоқ', 'no data for this period'],
  missingInvoice: ['Накладная больше не входит в текущий отчёт. Ниже показаны ранее загруженные данные.', 'Жүкқұжат ағымдағы есепте жоқ. Төменде бұрын жүктелген деректер көрсетілген.', 'This invoice is no longer in the current report. Previously loaded data is shown below.'],
  refreshing: ['Обновляем данные…', 'Деректер жаңартылуда…', 'Refreshing data…'],
  calculation: [
    'Показаны только проведённые приходные накладные iiko Office. Сумма, цена и НДС берутся из строк документа; текущая складская себестоимость и баланс взаиморасчётов не подставляются.',
    'Тек өткізілген iiko Office кіріс жүкқұжаттары көрсетіледі. Сома, баға және ҚҚС құжат жолдарынан алынады; ағымдағы қойма құны мен өзара есеп айырысу қалдығы қолданылмайды.',
    'Only posted incoming invoices from iiko Office are shown. Amount, price and VAT come from document lines; current stock cost and supplier account balance are not substituted.',
  ],
  Department: ['Филиал', 'Филиал', 'Branch'],
  Store: ['Склад', 'Қойма', 'Store'],
  Supplier: ['Поставщик', 'Жеткізуші', 'Supplier'],
  Document: ['Накладная №', 'Жүкқұжат №', 'Invoice no.'],
  Date: ['Дата и время', 'Күні мен уақыты', 'Date and time'],
  Products: ['Позиций', 'Позициялар', 'Items'],
  Product: ['Товар', 'Тауар', 'Product'],
  Article: ['Артикул', 'Артикул', 'Article'],
  Unit: ['Единица', 'Өлшем бірлігі', 'Unit'],
  Quantity: ['Количество', 'Саны', 'Quantity'],
  Price: ['Цена, ₸', 'Баға, ₸', 'Price, ₸'],
  Vat: ['НДС, ₸', 'ҚҚС, ₸', 'VAT, ₸'],
  Total: ['Сумма, ₸', 'Сома, ₸', 'Amount, ₸'],
  Comment: ['Комментарий', 'Түсініктеме', 'Comment'],
};

export const invoiceText = (locale: string, key: string) =>
  labels[key]?.[locale === 'kk' ? 1 : locale === 'en' ? 2 : 0] ?? key;
