const BASE_URL = 'https://bulka.com.kz';
const SUPPORTED_LEGAL_LANGUAGES = Object.freeze(['ru', 'kk', 'en']);
const LEGAL_PAGE_SLUGS = Object.freeze([
  'public-offer',
  'payment-and-refund',
  'delivery-terms',
  'company-details',
  'privacy',
  'terms',
]);

const common = {
  ru: {
    back: 'Вернуться в Bulka',
    language: 'Язык страницы',
    languages: { ru: 'Русский', kk: 'Қазақша', en: 'English' },
    footer: {
      'public-offer': 'Публичная оферта',
      'payment-and-refund': 'Оплата и возврат',
      'delivery-terms': 'Условия доставки',
      'company-details': 'Реквизиты компании',
      privacy: 'Политика конфиденциальности',
      terms: 'Условия использования',
    },
  },
  kk: {
    back: 'Bulka-ға оралу',
    language: 'Бет тілі',
    languages: { ru: 'Русский', kk: 'Қазақша', en: 'English' },
    footer: {
      'public-offer': 'Жария оферта',
      'payment-and-refund': 'Төлем және қайтару',
      'delivery-terms': 'Жеткізу шарттары',
      'company-details': 'Компания деректемелері',
      privacy: 'Құпиялылық саясаты',
      terms: 'Пайдалану шарттары',
    },
  },
  en: {
    back: 'Return to Bulka',
    language: 'Page language',
    languages: { ru: 'Русский', kk: 'Қазақша', en: 'English' },
    footer: {
      'public-offer': 'Public offer',
      'payment-and-refund': 'Payment and refunds',
      'delivery-terms': 'Delivery terms',
      'company-details': 'Company details',
      privacy: 'Privacy policy',
      terms: 'Terms of use',
    },
  },
};

const pages = {
  'public-offer': {
    ru: {
      title: 'Публичная оферта интернет-магазина Bulka',
      description:
        'Публичная оферта ИП РУБЛЕВА о розничной продаже товаров через сайт и приложение Bulka.',
      updated: 'Редакция от 27 июля 2026 года',
      summary: [
        ['Продавец', 'ИП РУБЛЕВА, ИИН 680225402521.'],
        ['Акцепт', 'Подтверждение заказа означает полное принятие условий оферты.'],
        ['Контакты', '+7 701 277 22 33 и bulka.kazakhstan@mail.ru.'],
      ],
      body: `
        <section class="notice">
          <h2>1. Статус документа</h2>
          <p>Настоящий документ является публичной офертой ИП РУБЛЕВА (далее — «Продавец»)
            о заключении договора розничной купли-продажи товаров через интернет-магазин Bulka
            на сайте <a href="${BASE_URL}/">${BASE_URL}/</a> и в мобильном приложении.</p>
          <p>Оферта применяется вместе с выбранными Покупателем условиями конкретного заказа:
            наименованием и количеством товаров, ценой, филиалом, способом и временем получения,
            адресом и стоимостью доставки. Эти сведения показываются до подтверждения заказа и
            становятся частью договора.</p>
        </section>
        <section>
          <h2>2. Основные понятия</h2>
          <ul>
            <li><strong>Покупатель</strong> — дееспособное физическое лицо, оформляющее заказ для
              личного, семейного или иного использования, не связанного с предпринимательством.</li>
            <li><strong>Товар</strong> — продукция, доступная для заказа в выбранном филиале Bulka.</li>
            <li><strong>Заказ</strong> — выбранные Покупателем товары и условия их оплаты и
              получения, зарегистрированные системой под уникальным номером.</li>
            <li><strong>Сервис</strong> — сайт и мобильное приложение Bulka, через которые
              Покупатель знакомится с ассортиментом и оформляет заказ.</li>
          </ul>
        </section>
        <section>
          <h2>3. Предмет договора</h2>
          <p>Продавец обязуется передать Покупателю товары из подтверждённого заказа, а Покупатель
            обязуется принять и оплатить их на условиях настоящей оферты. Договор заключается для
            каждого заказа отдельно. Продажа осуществляется в пределах фактического ассортимента,
            остатков, графика и зоны обслуживания выбранного филиала.</p>
        </section>
        <section>
          <h2>4. Информация о товарах и цена</h2>
          <ul>
            <li>Название, состав, масса или объём, цена в тенге и иные доступные характеристики
              указываются в карточке товара и при оформлении заказа.</li>
            <li>Фотографии носят иллюстративный характер: внешний вид готовой продукции может
              незначительно отличаться из-за ручного приготовления, без изменения заявленного
              состава и потребительских свойств.</li>
            <li>Цена конкретного заказа фиксируется при его подтверждении. Итоговая сумма, скидки,
              бонусы и стоимость доставки показываются до акцепта.</li>
            <li>Отображение товара, недоступного для заказа в выбранном филиале, является
              информацией об ассортименте и не обязывает Продавца передать отсутствующий товар.</li>
          </ul>
        </section>
        <section>
          <h2>5. Оформление заказа и акцепт оферты</h2>
          <ol>
            <li>Покупатель выбирает филиал, товары, способ получения, дату и время, а при доставке
              указывает точный адрес, телефон и необходимые комментарии.</li>
            <li>До отправки заказа Покупатель проверяет его состав, итоговую цену и условия
              получения, знакомится с настоящей офертой и обязательными юридическими документами.</li>
            <li>Нажатие кнопки подтверждения заказа (например, «Оформить заказ»), а при выбранной
              предоплате также совершение платежа, является полным и безоговорочным акцептом
              настоящей оферты.</li>
            <li>Договор считается заключённым после регистрации подтверждённого заказа в системе
              Bulka и присвоения ему номера. Подтверждение отображается в Сервисе и может быть
              направлено по указанному Покупателем каналу связи.</li>
          </ol>
          <p>Если после регистрации заказа выяснится, что товар отсутствует или заказ невозможно
            выполнить на выбранных условиях, Продавец до передачи заказа предложит замену либо
            изменение условий. Замена производится только с согласия Покупателя. При отказе
            Покупателя заказ отменяется, а полученная оплата возвращается.</p>
        </section>
        <section>
          <h2>6. Оплата и документы</h2>
          <p>Расчёты производятся в казахстанских тенге способами, доступными при оформлении:
            через Kaspi Pay, банковской картой через защищённую страницу ForteBank либо иным
            показанным способом. Bulka не получает и не хранит полный номер карты, срок её действия
            и CVC/CVV. Платёж считается совершённым после подтверждения платёжным сервисом.</p>
          <p>После подтверждённой оплаты Покупателю предоставляется торговый или иной предусмотренный
            законодательством платёжный документ. Подробные правила опубликованы на странице
            <a href="/payment-and-refund">«Условия оплаты и возврата»</a>.</p>
        </section>
        <section>
          <h2>7. Самовывоз, предзаказ и доставка</h2>
          <p>Доступные способы получения, филиал, ориентировочное время готовности и стоимость
            доставки показываются до подтверждения заказа. Покупатель обязан проверить филиал и
            адрес. Время приготовления и доставки является расчётным и может измениться из-за
            объёма заказа, загрузки филиала, дорожной ситуации, погоды и иных обстоятельств.</p>
          <p>При получении заказа Покупатель или указанный им получатель должен сообщить номер заказа
            либо иные данные, позволяющие идентифицировать заказ. Полные правила размещены в
            <a href="/delivery-terms">условиях доставки и получения</a>.</p>
        </section>
        <section>
          <h2>8. Изменение, отмена и возврат</h2>
          <p>Запросить изменение или отмену можно через поддержку. Возможность изменения зависит от
            того, начато ли приготовление и передан ли заказ курьеру. Если Продавец отменяет
            оплаченный заказ или не может передать оплаченный товар, сумма возвращается тем же
            способом, которым была получена, если иной законный способ не согласован с Покупателем.</p>
          <p>Возврат и обмен осуществляются в объёме, предусмотренном законодательством Республики
            Казахстан, с учётом характера и срока годности пищевой продукции. Настоящая оферта не
            ограничивает обязательные права потребителя. Порядок обращения и сроки возврата
            опубликованы в <a href="/payment-and-refund">условиях оплаты и возврата</a>.</p>
        </section>
        <section>
          <h2>9. Приёмка, качество и безопасность</h2>
          <p>При получении рекомендуется проверить количество, ассортимент, целостность упаковки и
            видимые недостатки. Сообщение о скрытом недостатке или ненадлежащем качестве можно
            направить после получения в пределах сроков, установленных законодательством.</p>
          <p>Информация о составе и аллергенах приводится в карточке товара или на упаковке при её
            наличии. На общей кухне возможен перекрёстный контакт ингредиентов. При аллергии или
            медицинских ограничениях Покупателю следует до заказа уточнить состав у поддержки.
            Полученную продукцию необходимо хранить и употребить с соблюдением указанных условий и
            срока годности.</p>
        </section>
        <section>
          <h2>10. Аккаунт, связь и бонусы</h2>
          <p>Покупатель отвечает за достоверность контактных и адресных данных, сохранность доступа
            к своему номеру телефона и конфиденциальность кодов входа. Сервисные сообщения о заказе,
            оплате, доставке и возврате могут направляться по телефону, в приложении, SMS или
            мессенджере.</p>
          <p>Условия бонусной программы показываются в Сервисе. Бонусы не являются деньгами, не
            подлежат обналичиванию и применяются только в порядке, доступном при оформлении заказа.</p>
        </section>
        <section>
          <h2>11. Персональные данные</h2>
          <p>Персональные данные обрабатываются для оформления и исполнения заказа, оплаты,
            доставки, поддержки и выполнения требований закона в соответствии с
            <a href="/privacy">Политикой конфиденциальности</a>. Передача данных банкам, курьерским
            и коммуникационным сервисам допускается только в необходимом для этих целей объёме.</p>
        </section>
        <section>
          <h2>12. Ответственность и обстоятельства непреодолимой силы</h2>
          <p>Стороны несут ответственность по законодательству Республики Казахстан. Продавец не
            отвечает за задержку или невозможность исполнения, вызванную недостоверными данными
            Покупателя либо чрезвычайными и непредотвратимыми обстоятельствами вне разумного
            контроля, но обязан сообщить о проблеме и исполнить предусмотренные законом обязанности.
            Ничто в настоящем разделе не исключает ответственность, которую нельзя ограничить
            соглашением сторон.</p>
        </section>
        <section>
          <h2>13. Обращения и споры</h2>
          <p>По вопросу заказа Покупатель может позвонить по номеру
            <a href="tel:+77012772233">+7 701 277 22 33</a> или написать на
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a>. В обращении
            следует указать номер заказа, суть требования и приложить подтверждающие материалы.
            Продавец рассматривает обращение в сроки, установленные законодательством.</p>
          <p>Стороны стремятся урегулировать спор путём переговоров и претензионного порядка. Если
            это не удалось, Покупатель вправе обратиться в уполномоченные органы или суд. Применяется
            законодательство Республики Казахстан.</p>
        </section>
        <section>
          <h2>14. Срок действия и изменение оферты</h2>
          <p>Оферта действует с момента публикации. К конкретному заказу применяется редакция,
            действовавшая в момент его акцепта. Новая редакция не изменяет уже заключённый договор
            без согласия Покупателя. Актуальная версия постоянно доступна по адресу
            <a href="${BASE_URL}/public-offer">${BASE_URL}/public-offer</a>.</p>
        </section>
        <section class="notice">
          <h2>15. Продавец</h2>
          <p><strong>ИП РУБЛЕВА</strong><br />
            ИИН: 680225402521<br />
            Юридический адрес: Республика Казахстан, г. Актау, 32А, дом 6, кв./офис 24<br />
            Телефон: <a href="tel:+77012772233">+7 701 277 22 33</a><br />
            Email: <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a></p>
          <p>Банковские и полные контактные сведения опубликованы на странице
            <a href="/company-details">«Реквизиты компании»</a>.</p>
        </section>`,
    },
    kk: {
      title: 'Bulka интернет-дүкенінің жария офертасы',
      description:
        'ИП РУБЛЕВА-ның Bulka сайты мен қолданбасы арқылы тауарларды бөлшек сату туралы жария офертасы.',
      updated: '2026 жылғы 27 шілдедегі редакция',
      summary: [
        ['Сатушы', 'ИП РУБЛЕВА, ЖСН 680225402521.'],
        ['Акцепт', 'Тапсырысты растау оферта талаптарын толық қабылдауды білдіреді.'],
        ['Байланыс', '+7 701 277 22 33 және bulka.kazakhstan@mail.ru.'],
      ],
      body: `
        <section class="notice">
          <h2>1. Құжаттың мәртебесі</h2>
          <p>Осы құжат ИП РУБЛЕВА-ның (бұдан әрі — «Сатушы»)
            <a href="${BASE_URL}/">${BASE_URL}/</a> сайтындағы және мобильді қолданбадағы Bulka
            интернет-дүкені арқылы тауарларды бөлшек сатып алу-сату шартын жасасу туралы жария
            офертасы болып табылады.</p>
          <p>Оферта Сатып алушы таңдаған нақты тапсырыс талаптарымен бірге қолданылады: тауарлардың
            атауы мен саны, бағасы, филиал, алу тәсілі мен уақыты, жеткізу мекенжайы мен құны.
            Бұл мәліметтер тапсырысты растағанға дейін көрсетіледі және шарттың бір бөлігі болады.</p>
        </section>
        <section>
          <h2>2. Негізгі ұғымдар</h2>
          <ul>
            <li><strong>Сатып алушы</strong> — кәсіпкерлікке байланысты емес жеке, отбасылық немесе
              өзге мақсатта тапсырыс беретін әрекетке қабілетті жеке тұлға.</li>
            <li><strong>Тауар</strong> — Bulka-ның таңдалған филиалында тапсырыс беруге қолжетімді
              өнім.</li>
            <li><strong>Тапсырыс</strong> — Сатып алушы таңдаған, жүйеде бірегей нөмірмен тіркелген
              тауарлар және оларды төлеу мен алу талаптары.</li>
            <li><strong>Сервис</strong> — Сатып алушы ассортиментпен танысып, тапсырыс беретін Bulka
              сайты мен мобильді қолданбасы.</li>
          </ul>
        </section>
        <section>
          <h2>3. Шарттың мәні</h2>
          <p>Сатушы расталған тапсырыстағы тауарларды Сатып алушыға беруге, ал Сатып алушы оларды
            осы оферта талаптарымен қабылдап, төлеуге міндеттенеді. Әр тапсырыс бойынша жеке шарт
            жасалады. Сату таңдалған филиалдың нақты ассортименті, қоры, жұмыс кестесі және қызмет
            көрсету аймағы шегінде жүзеге асырылады.</p>
        </section>
        <section>
          <h2>4. Тауар туралы ақпарат және баға</h2>
          <ul>
            <li>Атауы, құрамы, салмағы немесе көлемі, теңгемен көрсетілген бағасы және басқа
              қолжетімді сипаттамалары тауар карточкасында және тапсырыс беру кезінде көрсетіледі.</li>
            <li>Фотосуреттер көрнекілік үшін берілген: қолмен дайындалуына байланысты дайын өнімнің
              сыртқы көрінісі мәлімделген құрам мен тұтынушылық қасиеттер өзгермей, аздап
              ерекшеленуі мүмкін.</li>
            <li>Нақты тапсырыстың бағасы оны растау кезінде бекітіледі. Қорытынды сома, жеңілдіктер,
              бонустар және жеткізу құны акцептке дейін көрсетіледі.</li>
            <li>Таңдалған филиалда тапсырыс беруге қолжетімсіз тауардың көрсетілуі ассортимент
              туралы ақпарат болып табылады және Сатушыны жоқ тауарды беруге міндеттемейді.</li>
          </ul>
        </section>
        <section>
          <h2>5. Тапсырысты рәсімдеу және офертаны акцептеу</h2>
          <ol>
            <li>Сатып алушы филиалды, тауарларды, алу тәсілін, күн мен уақытты таңдайды, ал жеткізу
              кезінде нақты мекенжайды, телефон нөмірін және қажетті түсініктемелерді көрсетеді.</li>
            <li>Тапсырысты жібергенге дейін Сатып алушы оның құрамын, қорытынды бағасын және алу
              талаптарын тексереді, осы офертамен және міндетті заң құжаттарымен танысады.</li>
            <li>Тапсырысты растау батырмасын (мысалы, «Тапсырыс беру») басу, ал алдын ала төлем
              таңдалса, төлем жасау осы офертаны толық және сөзсіз акцептеу болып табылады.</li>
            <li>Шарт расталған тапсырыс Bulka жүйесінде тіркеліп, оған нөмір берілгеннен кейін
              жасалған болып есептеледі. Растау Сервисте көрсетіледі және Сатып алушы көрсеткен
              байланыс арнасына жіберілуі мүмкін.</li>
          </ol>
          <p>Тапсырыс тіркелгеннен кейін тауардың жоқ екені немесе таңдалған талаптармен орындау
            мүмкін еместігі анықталса, Сатушы тапсырысты бермей тұрып ауыстыруды не талаптарды
            өзгертуді ұсынады. Ауыстыру тек Сатып алушының келісімімен жасалады. Сатып алушы бас
            тартса, тапсырыс жойылып, алынған төлем қайтарылады.</p>
        </section>
        <section>
          <h2>6. Төлем және құжаттар</h2>
          <p>Есеп айырысу тапсырыс беру кезінде қолжетімді тәсілдермен Қазақстан теңгесінде
            жүргізіледі: Kaspi Pay арқылы, ForteBank қорғалған бетінде банк картасымен немесе
            көрсетілген өзге тәсілмен. Bulka картаның толық нөмірін, жарамдылық мерзімін және
            CVC/CVV кодын алмайды және сақтамайды. Төлемді төлем сервисі растағаннан кейін ол
            жасалған болып есептеледі.</p>
          <p>Расталған төлемнен кейін Сатып алушыға сауда чегі немесе заңнамада көзделген өзге төлем
            құжаты беріледі. Толық ережелер
            <a href="/kk/payment-and-refund">«Төлем және қайтару шарттары»</a> бетінде жарияланған.</p>
        </section>
        <section>
          <h2>7. Өзі алып кету, алдын ала тапсырыс және жеткізу</h2>
          <p>Қолжетімді алу тәсілдері, филиал, дайын болудың болжамды уақыты және жеткізу құны
            тапсырыс расталғанға дейін көрсетіледі. Сатып алушы филиал мен мекенжайды тексеруге
            міндетті. Дайындау және жеткізу уақыты есептік болып табылады және тапсырыс көлеміне,
            филиал жүктемесіне, жол жағдайына, ауа райына және өзге мән-жайларға байланысты өзгеруі
            мүмкін.</p>
          <p>Тапсырысты алған кезде Сатып алушы немесе ол көрсеткен алушы тапсырыс нөмірін не
            тапсырысты анықтауға мүмкіндік беретін басқа деректерді айтуы тиіс. Толық ережелер
            <a href="/kk/delivery-terms">жеткізу және алу шарттарында</a> берілген.</p>
        </section>
        <section>
          <h2>8. Өзгерту, жою және қайтару</h2>
          <p>Өзгерту немесе жою туралы қолдау қызметіне хабарласуға болады. Өзгерту мүмкіндігі
            дайындаудың басталғанына және тапсырыстың курьерге берілгеніне байланысты. Сатушы
            төленген тапсырысты жойса немесе төленген тауарды бере алмаса, Сатып алушымен өзге заңды
            тәсіл келісілмеген жағдайда, сома алынған тәсілмен қайтарылады.</p>
          <p>Қайтару және айырбастау азық-түлік өнімдерінің сипаты мен жарамдылық мерзімі ескеріле
            отырып, Қазақстан Республикасының заңнамасында көзделген көлемде жүзеге асырылады. Осы
            оферта тұтынушының міндетті құқықтарын шектемейді. Өтініш беру тәртібі мен қайтару
            мерзімдері <a href="/kk/payment-and-refund">төлем және қайтару шарттарында</a>
            жарияланған.</p>
        </section>
        <section>
          <h2>9. Қабылдау, сапа және қауіпсіздік</h2>
          <p>Тапсырысты алған кезде тауардың санын, ассортиментін, қаптаманың бүтіндігін және
            көзге көрінетін кемшіліктерді тексеру ұсынылады. Жасырын кемшілік немесе тиісінше сапасыз
            тауар туралы заңнамада белгіленген мерзімдерде алғаннан кейін де хабарлауға болады.</p>
          <p>Құрамы мен аллергендер туралы ақпарат тауар карточкасында немесе қаптамада болған кезде
            көрсетіледі. Ортақ ас үйде ингредиенттердің айқаспалы жанасуы мүмкін. Аллергия немесе
            медициналық шектеу болса, Сатып алушы тапсырыс бермей тұрып құрамды қолдау қызметінен
            нақтылауы керек. Алынған өнім сақтау талаптары мен жарамдылық мерзімі сақталып
            пайдаланылуы тиіс.</p>
        </section>
        <section>
          <h2>10. Аккаунт, байланыс және бонустар</h2>
          <p>Сатып алушы байланыс және мекенжай деректерінің дұрыстығына, өз телефон нөміріне
            қолжетімділіктің сақталуына және кіру кодтарының құпиялылығына жауап береді. Тапсырыс,
            төлем, жеткізу және қайтару туралы сервистік хабарламалар телефон, қолданба, SMS немесе
            мессенджер арқылы жіберілуі мүмкін.</p>
          <p>Бонустық бағдарламаның талаптары Сервисте көрсетіледі. Бонустар ақша болып табылмайды,
            қолма-қол ақшаға айырбасталмайды және тапсырыс беру кезінде қолжетімді тәртіппен ғана
            қолданылады.</p>
        </section>
        <section>
          <h2>11. Дербес деректер</h2>
          <p>Дербес деректер тапсырысты рәсімдеу және орындау, төлем, жеткізу, қолдау және заң
            талаптарын орындау үшін <a href="/kk/privacy">Құпиялылық саясатына</a> сәйкес өңделеді.
            Деректер банктерге, курьерлік және коммуникациялық сервистерге осы мақсаттарға қажетті
            көлемде ғана беріледі.</p>
        </section>
        <section>
          <h2>12. Жауапкершілік және еңсерілмейтін күш мән-жайлары</h2>
          <p>Тараптар Қазақстан Республикасының заңнамасына сәйкес жауап береді. Сатушы Сатып
            алушының дұрыс емес деректерінен немесе ақылға қонымды бақылаудан тыс төтенше және алдын
            алуға болмайтын мән-жайлардан туындаған кешігуге не орындау мүмкін еместігіне жауап
            бермейді, бірақ мәселе туралы хабарлауға және заңда көзделген міндеттерін орындауға тиіс.
            Осы бөлімде тараптардың келісімімен шектеуге болмайтын жауапкершілік алып тасталмайды.</p>
        </section>
        <section>
          <h2>13. Өтініштер мен даулар</h2>
          <p>Тапсырыс бойынша Сатып алушы
            <a href="tel:+77012772233">+7 701 277 22 33</a> нөміріне қоңырау шала алады немесе
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a> мекенжайына жаза
            алады. Өтініште тапсырыс нөмірін, талаптың мәнін көрсетіп, растайтын материалдарды тіркеу
            керек. Сатушы өтінішті заңнамада белгіленген мерзімде қарайды.</p>
          <p>Тараптар дауды келіссөз және талап қою тәртібімен реттеуге ұмтылады. Нәтижеге қол
            жеткізілмесе, Сатып алушы уәкілетті органдарға немесе сотқа жүгінуге құқылы. Қазақстан
            Республикасының заңнамасы қолданылады.</p>
        </section>
        <section>
          <h2>14. Офертаның қолданылу мерзімі және өзгеруі</h2>
          <p>Оферта жарияланған сәттен бастап қолданылады. Нақты тапсырысқа оны акцептеу сәтінде
            қолданылған редакция қолданылады. Жаңа редакция Сатып алушының келісімінсіз бұрын
            жасалған шартты өзгертпейді. Өзекті нұсқа
            <a href="${BASE_URL}/kk/public-offer">${BASE_URL}/kk/public-offer</a> мекенжайында
            тұрақты қолжетімді.</p>
        </section>
        <section class="notice">
          <h2>15. Сатушы</h2>
          <p><strong>ИП РУБЛЕВА</strong><br />
            ЖСН: 680225402521<br />
            Заңды мекенжайы: Қазақстан Республикасы, Ақтау қ., 32А, 6-үй, 24-пәтер/кеңсе<br />
            Телефон: <a href="tel:+77012772233">+7 701 277 22 33</a><br />
            Email: <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a></p>
          <p>Банктік және толық байланыс деректері
            <a href="/kk/company-details">«Компания деректемелері»</a> бетінде жарияланған.</p>
        </section>`,
    },
    en: {
      title: 'Bulka online shop public offer',
      description:
        'Public offer by Individual Entrepreneur RUBLEVA for retail sales through the Bulka website and application.',
      updated: 'Version dated 27 July 2026',
      summary: [
        ['Seller', 'Individual Entrepreneur RUBLEVA, IIN 680225402521.'],
        ['Acceptance', 'Confirming an order means full acceptance of this offer.'],
        ['Contacts', '+7 701 277 22 33 and bulka.kazakhstan@mail.ru.'],
      ],
      body: `
        <section class="notice">
          <h2>1. Status of this document</h2>
          <p>This document is a public offer by Individual Entrepreneur RUBLEVA (the “Seller”) to
            enter into a retail sale contract through the Bulka online shop at
            <a href="${BASE_URL}/">${BASE_URL}/</a> and in the mobile application.</p>
          <p>The offer applies together with the terms selected by the Buyer for a particular order:
            product names and quantities, price, branch, fulfilment method and time, delivery address
            and delivery fee. These details are displayed before confirmation and form part of the
            contract.</p>
        </section>
        <section>
          <h2>2. Definitions</h2>
          <ul>
            <li><strong>Buyer</strong> means an individual with legal capacity who places an order
              for personal, family or other use unrelated to business activity.</li>
            <li><strong>Product</strong> means an item available to order from the selected Bulka
              branch.</li>
            <li><strong>Order</strong> means the products and payment and fulfilment terms selected
              by the Buyer and registered by the system under a unique number.</li>
            <li><strong>Service</strong> means the Bulka website and mobile application through
              which the Buyer reviews the range and places an order.</li>
          </ul>
        </section>
        <section>
          <h2>3. Subject of the contract</h2>
          <p>The Seller undertakes to transfer the products in the confirmed order to the Buyer, and
            the Buyer undertakes to accept and pay for them under this offer. A separate contract is
            formed for each order. Sales are subject to the actual range, stock, schedule and service
            area of the selected branch.</p>
        </section>
        <section>
          <h2>4. Product information and price</h2>
          <ul>
            <li>The product page and checkout show the name, ingredients, weight or volume, price in
              tenge and other available characteristics.</li>
            <li>Images are illustrative. Because products are prepared by hand, appearance may vary
              slightly without changing the stated ingredients or consumer properties.</li>
            <li>The price of a particular order is fixed when it is confirmed. The final amount,
              discounts, bonuses and delivery fee are shown before acceptance.</li>
            <li>A product displayed as unavailable for ordering from the selected branch is
              information about the range and does not oblige the Seller to supply an out-of-stock
              item.</li>
          </ul>
        </section>
        <section>
          <h2>5. Placing an order and accepting the offer</h2>
          <ol>
            <li>The Buyer selects the branch, products, fulfilment method, date and time and, for
              delivery, enters an accurate address, phone number and any necessary instructions.</li>
            <li>Before submitting the order, the Buyer checks its contents, final price and
              fulfilment terms and reviews this offer and the mandatory legal documents.</li>
            <li>Pressing the order confirmation button (for example, “Place order”), and completing
              payment where prepayment is selected, constitutes full and unconditional acceptance
              of this offer.</li>
            <li>The contract is formed when the confirmed order is registered in the Bulka system
              and assigned an order number. Confirmation is shown in the Service and may be sent
              through the communication channel provided by the Buyer.</li>
          </ol>
          <p>If, after registration, a product is unavailable or the order cannot be fulfilled on
            the selected terms, the Seller will offer a replacement or changed terms before
            handover. A replacement is made only with the Buyer’s consent. If the Buyer declines,
            the order is cancelled and any payment received is refunded.</p>
        </section>
        <section>
          <h2>6. Payment and documents</h2>
          <p>Payments are made in Kazakhstan tenge using the methods available at checkout: Kaspi
            Pay, bank card through the protected ForteBank page, or another displayed method. Bulka
            does not receive or store the full card number, expiry date or CVC/CVV. Payment is
            complete when confirmed by the payment service.</p>
          <p>After confirmed payment, the Buyer receives a merchant receipt or other payment
            document required by law. Full rules are published in the
            <a href="/en/payment-and-refund">Payment and refund terms</a>.</p>
        </section>
        <section>
          <h2>7. Collection, preorder and delivery</h2>
          <p>Available fulfilment methods, branch, estimated preparation time and delivery fee are
            shown before confirmation. The Buyer must check the branch and address. Preparation and
            delivery times are estimates and may change because of order size, branch workload,
            traffic, weather and other circumstances.</p>
          <p>On collection or delivery, the Buyer or designated recipient must provide the order
            number or other information that identifies the order. Full rules appear in the
            <a href="/en/delivery-terms">Delivery and fulfilment terms</a>.</p>
        </section>
        <section>
          <h2>8. Changes, cancellation and refunds</h2>
          <p>A change or cancellation may be requested through support. Availability depends on
            whether preparation has started and whether the order has been handed to a courier. If
            the Seller cancels a paid order or cannot supply a paid product, the amount is returned
            using the original method unless another lawful method is agreed with the Buyer.</p>
          <p>Returns and exchanges are provided to the extent required by the laws of the Republic
            of Kazakhstan, taking into account the nature and shelf life of food products. This
            offer does not limit mandatory consumer rights. The claim procedure and refund timing
            are published in the <a href="/en/payment-and-refund">Payment and refund terms</a>.</p>
        </section>
        <section>
          <h2>9. Acceptance, quality and safety</h2>
          <p>On receipt, the Buyer should check quantity, range, packaging integrity and visible
            defects. A hidden defect or quality issue may be reported after receipt within the
            periods established by law.</p>
          <p>Ingredient and allergen information is shown on the product page or packaging where
            available. Cross-contact between ingredients may occur in a shared kitchen. A Buyer
            with allergies or medical restrictions should confirm ingredients with support before
            ordering. Products must be stored and consumed in accordance with the stated conditions
            and shelf life.</p>
        </section>
        <section>
          <h2>10. Account, communications and bonuses</h2>
          <p>The Buyer is responsible for accurate contact and address details, retaining access to
            the phone number and keeping login codes confidential. Service messages about orders,
            payment, delivery and refunds may be sent by phone, in the application, by SMS or
            messenger.</p>
          <p>Bonus programme terms are displayed in the Service. Bonuses are not money, cannot be
            redeemed for cash and may be used only as made available at checkout.</p>
        </section>
        <section>
          <h2>11. Personal data</h2>
          <p>Personal data is processed to place and fulfil orders, process payments and delivery,
            provide support and meet legal requirements in accordance with the
            <a href="/en/privacy">Privacy policy</a>. Data is shared with banks, couriers and
            communication services only to the extent necessary for these purposes.</p>
        </section>
        <section>
          <h2>12. Liability and force majeure</h2>
          <p>The parties are liable under the laws of the Republic of Kazakhstan. The Seller is not
            liable for delay or inability to perform caused by inaccurate Buyer data or exceptional
            and unavoidable circumstances outside reasonable control, but must notify the Buyer and
            perform all duties required by law. Nothing in this section excludes liability that
            cannot be limited by agreement.</p>
        </section>
        <section>
          <h2>13. Claims and disputes</h2>
          <p>For an order-related issue, the Buyer may call
            <a href="tel:+77012772233">+7 701 277 22 33</a> or email
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a>. The claim should
            include the order number, requested remedy and supporting materials. The Seller reviews
            claims within the periods prescribed by law.</p>
          <p>The parties will seek to resolve disputes through negotiation and the claims procedure.
            If no resolution is reached, the Buyer may apply to an authorised body or court. The
            laws of the Republic of Kazakhstan apply.</p>
        </section>
        <section>
          <h2>14. Duration and changes</h2>
          <p>This offer takes effect on publication. The version in force when a particular order is
            accepted applies to that order. A new version does not change an existing contract
            without the Buyer’s consent. The current version is permanently available at
            <a href="${BASE_URL}/en/public-offer">${BASE_URL}/en/public-offer</a>.</p>
          <p>The English text is provided for convenience. The Kazakh and Russian versions govern
            transactions in the Republic of Kazakhstan.</p>
        </section>
        <section class="notice">
          <h2>15. Seller</h2>
          <p><strong>Individual Entrepreneur RUBLEVA</strong><br />
            IIN: 680225402521<br />
            Registered address: 32A, building 6, apartment/office 24, Aktau, Republic of Kazakhstan<br />
            Phone: <a href="tel:+77012772233">+7 701 277 22 33</a><br />
            Email: <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a></p>
          <p>Bank and full contact details are published on the
            <a href="/en/company-details">Company details</a> page.</p>
        </section>`,
    },
  },
  'payment-and-refund': {
    ru: {
      title: 'Условия оплаты и возврата',
      description:
        'Условия оплаты заказов Bulka банковской картой и через Kaspi Pay, отмены заказа и возврата денежных средств.',
      updated: 'Редакция от 25 июля 2026 года',
      summary: [
        ['Валюта — тенге', 'Полная сумма заказа и доставки показывается до перехода к оплате.'],
        ['Безопасная оплата', 'Данные банковской карты вводятся на защищённой странице банка.'],
        ['Возврат на карту', 'Деньги возвращаются тем же способом, которым был оплачен заказ.'],
      ],
      body: `
        <section>
          <h2>1. Общие положения</h2>
          <p>
            Настоящие условия распространяются на заказы в интернет-магазине Bulka по адресу
            <a href="${BASE_URL}/">${BASE_URL}/</a>. Наименование продавца и его реквизиты
            указываются в платёжном и фискальном документе по заказу. Оформляя и оплачивая заказ,
            покупатель подтверждает выбранные товары, филиал, способ получения, адрес, время и
            итоговую стоимость.
          </p>
        </section>
        <section>
          <h2>2. Приём платежей</h2>
          <ul>
            <li>Все цены и расчёты указаны в казахстанских тенге (₸).</li>
            <li>Доступные способы оплаты отображаются при оформлении заказа. Можно оплатить через
              Kaspi Pay либо банковской картой Visa или Mastercard, если карточный способ доступен
              в момент оформления.</li>
            <li>Карточный платёж обрабатывает АО «ForteBank» на своей защищённой платёжной странице.
              Bulka получает только результат операции и данные, необходимые для формирования
              чека.</li>
            <li>Bulka не получает и не хранит полный номер карты, срок её действия и код CVC/CVV.</li>
            <li>Заказ считается оплаченным после получения сервером подтверждённого успешного
              статуса от банка. При отказе банка деньги не считаются принятыми.</li>
            <li>Если после оплаты статус заказа не обновился, не оплачивайте его повторно —
              обратитесь в поддержку и сообщите номер заказа.</li>
          </ul>
          {{PAYMENT_LOGOS}}
        </section>
        <section>
          <h2>3. Как проходит оплата картой и 3‑D Secure</h2>
          <ol>
            <li>Проверьте состав заказа, филиал, способ получения и итоговую сумму в тенге.</li>
            <li>Выберите «Банковская карта» и перейдите на защищённую страницу ForteBank.</li>
            <li>Введите реквизиты карты только на странице банка. Адрес защищённой страницы должен
              начинаться с <strong>https://</strong>.</li>
            <li>При запросе 3‑D Secure подтвердите операцию одноразовым кодом, push-уведомлением
              или другим способом вашего банка. Никому не сообщайте код подтверждения.</li>
            <li>После успешной авторизации вернитесь в Bulka и дождитесь статуса «Оплачено».
              Торговый чек появится в деталях заказа и будет отправлен на номер клиента через
              WhatsApp.</li>
          </ol>
          <p>Если страница закрылась, код не пришёл или банк отклонил операцию, проверьте доступный
            лимит, правильность реквизитов и интернет-соединение. Не повторяйте оплату, пока не
            убедитесь, что списания не было. При списании без подтверждённого заказа обратитесь в
            Bulka и банк-эмитент, указав номер заказа, сумму и время операции.</p>
          <p>ForteBank обрабатывает карточные данные по требованиям PCI DSS; для дополнительной
            проверки используется технология 3‑D Secure.</p>
        </section>
        <section>
          <h2>4. Отмена заказа</h2>
          <p>Покупатель может запросить отмену через поддержку Bulka. Возможность отмены зависит от
            текущего статуса: начал ли филиал приготовление, передан ли заказ курьеру или уже выдан
            покупателю.</p>
          <p>Если Bulka не может выполнить оплаченный заказ из-за отсутствия товара, технической
            ошибки либо невозможности приготовления или доставки, покупателю предлагается замена,
            изменение заказа либо полный возврат уплаченной суммы — по выбору покупателя и в
            пределах требований законодательства Республики Казахстан.</p>
        </section>
        <section>
          <h2>5. Возврат товара и претензии по качеству</h2>
          <p>Если получен не тот товар, нарушена комплектация, товар повреждён, имеет истёкший срок
            годности или не соответствует заявленному качеству, сообщите об этом Bulka как можно
            скорее. Для проверки потребуются номер заказа, контактный телефон, описание проблемы
            и, при наличии, фотографии.</p>
          <p>После проверки покупателю предоставляется предусмотренное законом решение: замена,
            соразмерное уменьшение цены, частичный либо полный возврат. Порядок возврата пищевой
            продукции надлежащего качества определяется с учётом её свойств и законодательства
            Республики Казахстан. Эти условия не ограничивают законные права потребителя.</p>
        </section>
        <section>
          <h2>6. Порядок возврата денежных средств</h2>
          <ol>
            <li>Обратитесь в поддержку и сообщите номер заказа, телефон и причину обращения.</li>
            <li>Bulka проверит оплату, состав заказа, его статус и обстоятельства обращения.</li>
            <li>Ответ на письменную претензию предоставляется в срок, установленный
              законодательством Республики Казахстан, — не позднее 10 календарных дней.</li>
            <li>После одобрения полный или частичный возврат оформляется на тот же платёжный
              инструмент, которым был оплачен заказ. Возврат на другую карту или наличными вместо
              карточного платежа не производится.</li>
            <li>Срок фактического зачисления после оформления возврата зависит от банка-эмитента и
              платёжной системы. Bulka сообщит о выполнении возврата по обращению покупателя.</li>
          </ol>
        </section>
        <section class="notice">
          <h2>7. Как обратиться</h2>
          <p>Подготовьте номер заказа и телефон, использованный при оформлении. Обращение можно
            отправить через раздел «Поддержка» в личном кабинете, по телефону или электронной
            почте.</p>
          {{CONTACTS_RU}}
        </section>`,
    },
    kk: {
      title: 'Төлем және қайтару шарттары',
      description:
        'Bulka тапсырыстарын банк картасымен және Kaspi Pay арқылы төлеу, тапсырысты болдырмау және ақшаны қайтару шарттары.',
      updated: '2026 жылғы 25 шілдедегі редакция',
      summary: [
        ['Валюта — теңге', 'Тапсырыс пен жеткізудің толық сомасы төлемге дейін көрсетіледі.'],
        ['Қауіпсіз төлем', 'Банк картасының деректері банктің қорғалған бетінде енгізіледі.'],
        ['Картаға қайтару', 'Ақша тапсырыс төленген тәсілмен қайтарылады.'],
      ],
      body: `
        <section>
          <h2>1. Жалпы ережелер</h2>
          <p>Осы шарттар <a href="${BASE_URL}/">${BASE_URL}/</a> мекенжайындағы Bulka
            интернет-дүкенінде жасалған тапсырыстарға қолданылады. Сатушының атауы мен деректемелері
            тапсырыс бойынша төлем және фискалдық құжаттарда көрсетіледі. Тапсырысты рәсімдеу және
            төлеу арқылы сатып алушы таңдалған тауарларды, филиалды, алу тәсілін, мекенжайды, уақытты
            және қорытынды құнын растайды.</p>
        </section>
        <section>
          <h2>2. Төлемдерді қабылдау</h2>
          <ul>
            <li>Барлық бағалар мен есеп айырысулар Қазақстан теңгесімен (₸) көрсетіледі.</li>
            <li>Қолжетімді төлем тәсілдері тапсырысты рәсімдеу кезінде көрсетіледі. Kaspi Pay арқылы
              немесе карта арқылы төлеу тәсілі қолжетімді болса, Visa не Mastercard банк картасымен
              төлеуге болады.</li>
            <li>Карта төлемін «ForteBank» АҚ өзінің қорғалған төлем бетінде өңдейді. Bulka тек
              операция нәтижесін және чек қалыптастыруға қажетті деректерді алады.</li>
            <li>Bulka картаның толық нөмірін, жарамдылық мерзімін және CVC/CVV кодын алмайды әрі
              сақтамайды.</li>
            <li>Сервер банктен сәтті мәртебе туралы растау алғаннан кейін тапсырыс төленді деп
              есептеледі. Банк бас тартса, ақша қабылданды деп есептелмейді.</li>
            <li>Төлемнен кейін тапсырыс мәртебесі жаңармаса, қайта төлем жасамаңыз — қолдау қызметіне
              хабарласып, тапсырыс нөмірін айтыңыз.</li>
          </ul>
          {{PAYMENT_LOGOS}}
        </section>
        <section>
          <h2>3. Карта арқылы төлем және 3‑D Secure тәртібі</h2>
          <ol>
            <li>Тапсырыс құрамын, филиалды, алу тәсілін және теңгемен көрсетілген қорытынды соманы
              тексеріңіз.</li>
            <li>«Банк картасы» тәсілін таңдап, ForteBank-тің қорғалған бетіне өтіңіз.</li>
            <li>Карта деректерін тек банк бетінде енгізіңіз. Қорғалған беттің мекенжайы
              <strong>https://</strong> арқылы басталуға тиіс.</li>
            <li>3‑D Secure сұрауы шықса, операцияны бір реттік кодпен, push-хабарламамен немесе
              банкіңіз ұсынған басқа тәсілмен растаңыз. Растау кодын ешкімге айтпаңыз.</li>
            <li>Сәтті авторизациядан кейін Bulka-ға оралып, «Төленді» мәртебесін күтіңіз. Сауда чегі
              тапсырыс мәліметтерінде пайда болады және клиенттің нөміріне WhatsApp арқылы
              жіберіледі.</li>
          </ol>
          <p>Бет жабылып қалса, код келмесе немесе банк операциядан бас тартса, қолжетімді лимитті,
            деректердің дұрыстығын және интернет байланысын тексеріңіз. Ақша алынбағанына көз
            жеткізбей, төлемді қайталамаңыз. Расталған тапсырыссыз ақша есептен шығарылса, тапсырыс
            нөмірін, соманы және операция уақытын көрсетіп, Bulka-ға және карта шығарған банкке
            хабарласыңыз.</p>
          <p>ForteBank карта деректерін PCI DSS талаптарына сай өңдейді; қосымша тексеру үшін
            3‑D Secure технологиясы қолданылады.</p>
        </section>
        <section>
          <h2>4. Тапсырысты болдырмау</h2>
          <p>Сатып алушы Bulka қолдау қызметі арқылы тапсырысты болдырмауды сұрай алады. Болдырмау
            мүмкіндігі тапсырыстың ағымдағы мәртебесіне байланысты: филиал дайындауды бастады ма,
            тапсырыс курьерге берілді ме немесе сатып алушыға табысталды ма.</p>
          <p>Bulka тауардың болмауына, техникалық қатеге немесе дайындау не жеткізу мүмкін еместігіне
            байланысты төленген тапсырысты орындай алмаса, сатып алушының таңдауы бойынша және
            Қазақстан Республикасы заңнамасының талаптары шегінде тауарды ауыстыру, тапсырысты
            өзгерту немесе төленген соманы толық қайтару ұсынылады.</p>
        </section>
        <section>
          <h2>5. Тауарды қайтару және сапаға қатысты шағымдар</h2>
          <p>Басқа тауар берілсе, жинақталуы бұзылса, тауар зақымдалса, жарамдылық мерзімі өтсе немесе
            мәлімделген сапаға сәйкес келмесе, Bulka-ға мүмкіндігінше тез хабарлаңыз. Тексеру үшін
            тапсырыс нөмірі, байланыс телефоны, мәселенің сипаттамасы және бар болса фотосуреттер
            қажет.</p>
          <p>Тексеруден кейін сатып алушыға заңда көзделген шешім ұсынылады: ауыстыру, бағаны
            мөлшерлес төмендету, ішінара немесе толық қайтару. Сапасы тиісті тағам өнімін қайтару
            тәртібі оның қасиеттері мен Қазақстан Республикасының заңнамасы ескеріле отырып
            айқындалады. Осы шарттар тұтынушының заңды құқықтарын шектемейді.</p>
        </section>
        <section>
          <h2>6. Ақшаны қайтару тәртібі</h2>
          <ol>
            <li>Қолдау қызметіне хабарласып, тапсырыс нөмірін, телефонды және өтініш себебін
              айтыңыз.</li>
            <li>Bulka төлемді, тапсырыс құрамын, оның мәртебесін және өтініш жағдайларын тексереді.</li>
            <li>Жазбаша шағымға жауап Қазақстан Республикасының заңнамасында белгіленген мерзімде,
              бірақ 10 күнтізбелік күннен кешіктірілмей беріледі.</li>
            <li>Мақұлданғаннан кейін толық немесе ішінара қайтару тапсырыс төленген сол төлем
              құралына рәсімделеді. Карта төлемінің орнына басқа картаға немесе қолма-қол ақша
              қайтарылмайды.</li>
            <li>Қайтару рәсімделгеннен кейін ақшаның нақты түсу мерзімі карта шығарған банк пен төлем
              жүйесіне байланысты. Bulka сатып алушының өтініші бойынша қайтарудың орындалғанын
              хабарлайды.</li>
          </ol>
        </section>
        <section class="notice">
          <h2>7. Байланысу тәртібі</h2>
          <p>Тапсырыс нөмірін және рәсімдеу кезінде қолданылған телефонды дайындаңыз. Өтінішті жеке
            кабинеттегі «Қолдау» бөлімі, телефон немесе электрондық пошта арқылы жіберуге болады.</p>
          {{CONTACTS_KK}}
        </section>`,
    },
    en: {
      title: 'Payment and refund terms',
      description:
        'Terms for paying for Bulka orders by bank card and Kaspi Pay, cancelling an order and receiving a refund.',
      updated: 'Revision dated 25 July 2026',
      summary: [
        ['Currency — tenge', 'The full order and delivery total is shown before payment.'],
        ['Secure payment', 'Bank card details are entered on the bank’s protected payment page.'],
        [
          'Refund to source',
          'Money is returned through the same method used to pay for the order.',
        ],
      ],
      body: `
        <section>
          <h2>1. General provisions</h2>
          <p>These terms apply to orders placed in the Bulka online shop at
            <a href="${BASE_URL}/">${BASE_URL}/</a>. The seller’s name and details are stated in
            the payment and fiscal documents for the order. By placing and paying for an order,
            the customer confirms the selected goods, branch, fulfilment method, address, time and
            final price.</p>
        </section>
        <section>
          <h2>2. Payment acceptance</h2>
          <ul>
            <li>All prices and settlements are stated in Kazakhstan tenge (₸).</li>
            <li>Available payment methods are shown at checkout. Payment can be made through Kaspi
              Pay or with a Visa or Mastercard bank card when card payment is available.</li>
            <li>Card payments are processed by ForteBank JSC on its protected payment page. Bulka
              receives only the operation result and the information required to issue a receipt.</li>
            <li>Bulka does not receive or store the full card number, expiry date or CVC/CVV.</li>
            <li>An order is considered paid after the server receives a confirmed successful status
              from the bank. If the bank declines the operation, the money is not treated as
              accepted.</li>
            <li>If the order status does not update after payment, do not pay again. Contact support
              and provide the order number.</li>
          </ul>
          {{PAYMENT_LOGOS}}
        </section>
        <section>
          <h2>3. Card payment and 3‑D Secure</h2>
          <ol>
            <li>Check the order contents, branch, fulfilment method and final amount in tenge.</li>
            <li>Select “Bank card” and continue to the protected ForteBank page.</li>
            <li>Enter card details only on the bank’s page. The protected page address must begin
              with <strong>https://</strong>.</li>
            <li>If prompted for 3‑D Secure, confirm the operation with a one-time code, push
              notification or another method offered by your bank. Never share the confirmation
              code.</li>
            <li>After successful authorisation, return to Bulka and wait for the “Paid” status. The
              merchant receipt will appear in the order details and will be sent to the customer’s
              number through WhatsApp.</li>
          </ol>
          <p>If the page closes, the code does not arrive or the bank declines the operation, check
            the available limit, the entered details and the internet connection. Do not retry
            payment until you have confirmed that no debit occurred. If money was debited without a
            confirmed order, contact Bulka and the card-issuing bank and provide the order number,
            amount and operation time.</p>
          <p>ForteBank processes card data in accordance with PCI DSS requirements; 3‑D Secure is
            used for additional verification.</p>
        </section>
        <section>
          <h2>4. Order cancellation</h2>
          <p>The customer may request cancellation through Bulka support. Whether cancellation is
            possible depends on the current status: whether the branch has begun preparation, the
            order has been handed to a courier or it has already been collected.</p>
          <p>If Bulka cannot fulfil a paid order because an item is unavailable, a technical error
            occurred, or preparation or delivery is impossible, the customer will be offered a
            replacement, an order change or a full refund, at the customer’s choice and subject to
            the laws of the Republic of Kazakhstan.</p>
        </section>
        <section>
          <h2>5. Product returns and quality claims</h2>
          <p>If the wrong item is supplied, the order is incomplete, an item is damaged or expired,
            or it does not meet the stated quality, notify Bulka as soon as possible. The review
            requires the order number, contact phone number, a description of the issue and photos
            when available.</p>
          <p>After review, the customer receives the remedy provided by law: replacement,
            proportionate price reduction, partial refund or full refund. The return of food
            products of proper quality is determined with regard to their properties and the laws
            of the Republic of Kazakhstan. These terms do not restrict statutory consumer rights.</p>
        </section>
        <section>
          <h2>6. Refund procedure</h2>
          <ol>
            <li>Contact support and provide the order number, phone number and reason for the
              request.</li>
            <li>Bulka will verify the payment, order contents, status and circumstances.</li>
            <li>A written claim will be answered within the period required by the laws of the
              Republic of Kazakhstan and no later than 10 calendar days.</li>
            <li>Once approved, a full or partial refund is made to the same payment instrument used
              for the order. A card payment is not refunded to a different card or in cash.</li>
            <li>The actual crediting time after a refund is submitted depends on the card-issuing
              bank and payment system. Bulka will confirm completion upon the customer’s request.</li>
          </ol>
        </section>
        <section class="notice">
          <h2>7. Contacting us</h2>
          <p>Have the order number and the phone number used at checkout ready. A request may be sent
            through the “Support” section of the account, by phone or by email.</p>
          {{CONTACTS_EN}}
        </section>`,
    },
  },
  'delivery-terms': {
    ru: {
      title: 'Условия доставки',
      description:
        'Условия курьерской доставки заказов Bulka по Астане через сервис Яндекс Доставка.',
      updated: 'Редакция от 25 июля 2026 года',
      summary: [
        ['Яндекс Курьер', 'Заказ доставляет курьер сервиса Яндекс Доставка.'],
        ['Цена до оплаты', 'Стоимость доставки и общая сумма заказа показываются до оплаты.'],
        [
          'Статус заказа',
          'После назначения курьера могут отображаться его данные и ссылка отслеживания.',
        ],
      ],
      body: `
        <section>
          <h2>1. Общие положения</h2>
          <p>Настоящие условия применяются к заказам Bulka по городу Астана с выбранным способом
            получения «Доставка». Продавцом товаров является Bulka, а перевозку выполняет сторонний
            сервис Яндекс Доставка по тарифу для курьерской доставки.</p>
          <p>По вопросам состава, качества, оплаты и исполнения заказа покупатель обращается в
            Bulka. Курьер отвечает за получение заказа в выбранной пекарне и его перевозку по
            указанному адресу.</p>
        </section>
        <section>
          <h2>2. Доступность и зона доставки</h2>
          <ul>
            <li>Доставка доступна только для тех пекарен и адресов, для которых она разрешена при
              оформлении заказа.</li>
            <li>Возможность доставки зависит от зоны обслуживания, наличия свободных курьеров,
              дорожной и погодной обстановки, а также технической доступности сервиса Яндекс
              Доставка.</li>
            <li>Если доставить заказ по выбранному адресу невозможно, Bulka свяжется с покупателем
              и предложит изменить адрес, выбрать самовывоз либо отменить заказ с возвратом
              оплаты.</li>
          </ul>
        </section>
        <section>
          <h2>3. Адрес и контактные данные</h2>
          <p>Покупатель указывает точный адрес, подъезд, этаж, квартиру или офис, код домофона и
            контактный телефон, если эти сведения необходимы для передачи заказа. Покупатель должен
            оставаться на связи по указанному номеру.</p>
          <p>Для выполнения доставки Bulka передаёт сервису Яндекс Доставка необходимые сведения:
            имя получателя, телефон, адрес, маршрут и данные заказа в объёме, нужном для перевозки.
            Порядок обработки данных также описан в <a href="/privacy">Политике
            конфиденциальности</a>.</p>
          <p>Изменить адрес после оформления можно только через поддержку Bulka. После назначения
            или прибытия курьера изменение адреса может быть недоступно либо потребовать нового
            расчёта и повторного оформления доставки.</p>
        </section>
        <section>
          <h2>4. Стоимость и оплата</h2>
          <ul>
            <li>Все цены указываются в казахстанских тенге (₸).</li>
            <li>Стоимость доставки и итоговая сумма показываются покупателю до подтверждения
              оплаты.</li>
            <li>Изменение внутреннего тарифа сервиса Яндекс Доставка после успешной оплаты не
              изменяет уже оплаченную покупателем сумму.</li>
            <li>Курьер не должен требовать отдельную оплату, которая не была показана и согласована
              при оформлении заказа. В такой ситуации необходимо сразу обратиться в Bulka.</li>
          </ul>
        </section>
        <section>
          <h2>5. Срок и получение заказа</h2>
          <p>Указанное время доставки является ориентировочным. Оно включает приготовление и
            комплектацию заказа, поиск курьера и дорогу. Время может измениться из-за загрузки
            пекарни, спроса на курьеров, пробок, погоды и иных обстоятельств вне контроля Bulka.</p>
          <p>После назначения курьера покупателю могут быть доступны имя и телефон курьера,
            ориентировочное время прибытия и ссылка для отслеживания — если эти сведения переданы
            сервисом Яндекс Доставка.</p>
          <p>Заказ передаётся по указанному адресу получателю или лицу, которое приняло заказ от его
            имени. Если получатель не отвечает или отсутствует, курьер и Bulka пытаются связаться
            с ним. Повторная доставка при необходимости оформляется отдельно.</p>
        </section>
        <section>
          <h2>6. Отмена и проблемы с доставкой</h2>
          <p>Для отмены необходимо как можно раньше обратиться в поддержку Bulka. После
            подтверждения заявки сервисом Яндекс Доставка, назначения курьера или передачи ему
            заказа отмена может быть платной либо недоступной. Решение и размер возврата зависят от
            статуса заказа, понесённых расходов и требований законодательства Республики
            Казахстан.</p>
          <p>Если заказ не доставлен, повреждён, остыл из-за существенной задержки, имеет неверный
            состав или неполную комплектацию, сообщите об этом Bulka и укажите номер заказа. Замена,
            частичный или полный возврат рассматриваются по <a href="/payment-and-refund">Условиям
            оплаты и возврата</a>.</p>
        </section>
        <section class="notice">
          <h2>7. Как обратиться</h2>
          <p>Подготовьте номер заказа, адрес доставки и телефон, использованный при оформлении.
            Обращение можно отправить через раздел «Поддержка» или по телефону Bulka.</p>
          {{CONTACTS_RU}}
        </section>`,
    },
    kk: {
      title: 'Жеткізу шарттары',
      description:
        'Яндекс Доставка сервисі арқылы Астана қаласында Bulka тапсырыстарын курьермен жеткізу шарттары.',
      updated: '2026 жылғы 25 шілдедегі редакция',
      summary: [
        ['Яндекс Курьер', 'Тапсырысты Яндекс Доставка сервисінің курьері жеткізеді.'],
        [
          'Төлемге дейінгі баға',
          'Жеткізу құны мен тапсырыстың жалпы сомасы төлемге дейін көрсетіледі.',
        ],
        [
          'Тапсырыс мәртебесі',
          'Курьер тағайындалғаннан кейін оның деректері мен бақылау сілтемесі көрсетілуі мүмкін.',
        ],
      ],
      body: `
        <section>
          <h2>1. Жалпы ережелер</h2>
          <p>Осы шарттар Астана қаласында «Жеткізу» алу тәсілі таңдалған Bulka тапсырыстарына
            қолданылады. Тауар сатушысы — Bulka, ал тасымалдауды курьерлік жеткізу тарифі бойынша
            үшінші тарап — Яндекс Доставка сервисі орындайды.</p>
          <p>Тапсырыстың құрамы, сапасы, төлемі және орындалуы жөніндегі мәселелер бойынша сатып
            алушы Bulka-ға хабарласады. Курьер тапсырысты таңдалған наубайханадан алып, көрсетілген
            мекенжайға жеткізуге жауап береді.</p>
        </section>
        <section>
          <h2>2. Жеткізудің қолжетімділігі мен аймағы</h2>
          <ul>
            <li>Жеткізу тапсырысты рәсімдеу кезінде рұқсат етілген наубайханалар мен мекенжайлар
              үшін ғана қолжетімді.</li>
            <li>Жеткізу мүмкіндігі қызмет көрсету аймағына, бос курьерлердің болуына, жол және ауа
              райы жағдайына, сондай-ақ Яндекс Доставка сервисінің техникалық қолжетімділігіне
              байланысты.</li>
            <li>Таңдалған мекенжайға жеткізу мүмкін болмаса, Bulka сатып алушымен байланысып,
              мекенжайды өзгертуді, өздігінен алып кетуді немесе төлемді қайтарып, тапсырысты
              болдырмауды ұсынады.</li>
          </ul>
        </section>
        <section>
          <h2>3. Мекенжай және байланыс деректері</h2>
          <p>Сатып алушы тапсырысты табыстауға қажет болса, нақты мекенжайды, кіреберісті, қабатты,
            пәтерді немесе кеңсені, домофон кодын және байланыс телефонын көрсетеді. Сатып алушы
            көрсетілген нөмір бойынша байланыста болуға тиіс.</p>
          <p>Жеткізуді орындау үшін Bulka Яндекс Доставка сервисіне қажетті көлемде алушының атын,
            телефонын, мекенжайын, маршрутты және тапсырыс туралы мәліметтерді береді. Деректерді
            өңдеу тәртібі <a href="/kk/privacy">Құпиялылық саясатында</a> да сипатталған.</p>
          <p>Рәсімделгеннен кейін мекенжайды тек Bulka қолдау қызметі арқылы өзгертуге болады.
            Курьер тағайындалғаннан немесе келгеннен кейін мекенжайды өзгерту мүмкін болмауы не
            жеткізуді қайта есептеп, жаңадан рәсімдеуді талап етуі мүмкін.</p>
        </section>
        <section>
          <h2>4. Құны және төлемі</h2>
          <ul>
            <li>Барлық бағалар Қазақстан теңгесімен (₸) көрсетіледі.</li>
            <li>Жеткізу құны мен қорытынды сома сатып алушыға төлем расталғанға дейін көрсетіледі.</li>
            <li>Сәтті төлемнен кейін Яндекс Доставка сервисінің ішкі тарифі өзгерсе де, сатып алушы
              төлеген сома өзгермейді.</li>
            <li>Курьер тапсырысты рәсімдеу кезінде көрсетілмеген және келісілмеген бөлек төлемді
              талап етпеуге тиіс. Мұндай жағдайда дереу Bulka-ға хабарласу қажет.</li>
          </ul>
        </section>
        <section>
          <h2>5. Мерзімі және тапсырысты алу</h2>
          <p>Көрсетілген жеткізу уақыты болжамды. Оған тапсырысты дайындау және жинақтау, курьерді
            іздеу және жол уақыты кіреді. Наубайхананың жүктемесіне, курьерлерге сұранысқа, кептеліске,
            ауа райына және Bulka бақылауынан тыс өзге жағдайларға байланысты уақыт өзгеруі мүмкін.</p>
          <p>Курьер тағайындалғаннан кейін, егер Яндекс Доставка сервисі осы мәліметтерді берсе,
            сатып алушыға курьердің аты мен телефоны, болжамды келу уақыты және бақылау сілтемесі
            қолжетімді болуы мүмкін.</p>
          <p>Тапсырыс көрсетілген мекенжайда алушыға немесе оның атынан тапсырысты қабылдаған адамға
            беріледі. Алушы жауап бермесе немесе орнында болмаса, курьер мен Bulka онымен
            байланысуға тырысады. Қажет болса, қайта жеткізу бөлек рәсімделеді.</p>
        </section>
        <section>
          <h2>6. Болдырмау және жеткізу мәселелері</h2>
          <p>Болдырмау үшін Bulka қолдау қызметіне мүмкіндігінше ертерек хабарласу керек. Яндекс
            Доставка сервисі өтінімді растағаннан, курьер тағайындалғаннан немесе тапсырыс оған
            берілгеннен кейін болдырмау ақылы болуы не қолжетімсіз болуы мүмкін. Шешім мен қайтару
            мөлшері тапсырыс мәртебесіне, жұмсалған шығындарға және Қазақстан Республикасы
            заңнамасының талаптарына байланысты.</p>
          <p>Тапсырыс жеткізілмесе, зақымдалса, елеулі кідірістен суып қалса, құрамы қате немесе
            толық болмаса, Bulka-ға хабарлап, тапсырыс нөмірін көрсетіңіз. Ауыстыру, ішінара немесе
            толық қайтару <a href="/kk/payment-and-refund">Төлем және қайтару шарттарына</a> сай
            қаралады.</p>
        </section>
        <section class="notice">
          <h2>7. Байланысу тәртібі</h2>
          <p>Тапсырыс нөмірін, жеткізу мекенжайын және рәсімдеу кезінде қолданылған телефонды
            дайындаңыз. Өтінішті «Қолдау» бөлімі арқылы немесе Bulka телефонына хабарласып жіберуге
            болады.</p>
          {{CONTACTS_KK}}
        </section>`,
    },
    en: {
      title: 'Delivery terms',
      description: 'Terms for courier delivery of Bulka orders in Astana through Yandex Delivery.',
      updated: 'Revision dated 25 July 2026',
      summary: [
        ['Yandex Courier', 'The order is delivered by a courier from Yandex Delivery.'],
        ['Price before payment', 'The delivery fee and full order total are shown before payment.'],
        [
          'Order status',
          'Courier details and a tracking link may be shown after a courier is assigned.',
        ],
      ],
      body: `
        <section>
          <h2>1. General provisions</h2>
          <p>These terms apply to Bulka orders in Astana where “Delivery” is selected as the
            fulfilment method. Bulka is the seller of the goods, while transport is performed by the
            third-party Yandex Delivery service at its courier delivery tariff.</p>
          <p>Customers contact Bulka about order contents, quality, payment and fulfilment. The
            courier is responsible for collecting the order from the selected bakery and
            transporting it to the stated address.</p>
        </section>
        <section>
          <h2>2. Availability and delivery area</h2>
          <ul>
            <li>Delivery is available only for bakeries and addresses where it is enabled at
              checkout.</li>
            <li>Availability depends on the service area, available couriers, road and weather
              conditions and the technical availability of Yandex Delivery.</li>
            <li>If the selected address cannot be served, Bulka will contact the customer and offer
              an address change, pickup, or cancellation with a refund.</li>
          </ul>
        </section>
        <section>
          <h2>3. Address and contact details</h2>
          <p>The customer provides an accurate address, entrance, floor, apartment or office,
            intercom code and contact phone number when these details are required to hand over the
            order. The customer must remain reachable on the stated number.</p>
          <p>To perform delivery, Bulka gives Yandex Delivery the recipient’s name, phone number,
            address, route and order information to the extent required for transport. Data
            processing is also described in the <a href="/en/privacy">Privacy policy</a>.</p>
          <p>An address can be changed after checkout only through Bulka support. Once a courier is
            assigned or has arrived, an address change may be unavailable or may require a new
            calculation and a new delivery request.</p>
        </section>
        <section>
          <h2>4. Price and payment</h2>
          <ul>
            <li>All prices are stated in Kazakhstan tenge (₸).</li>
            <li>The delivery fee and final total are shown before the customer confirms payment.</li>
            <li>A change in Yandex Delivery’s internal tariff after successful payment does not
              change the amount already paid by the customer.</li>
            <li>The courier must not demand a separate payment that was not shown and agreed at
              checkout. Contact Bulka immediately if this occurs.</li>
          </ul>
        </section>
        <section>
          <h2>5. Timing and receipt of the order</h2>
          <p>The stated delivery time is an estimate. It includes preparation and packing, finding a
            courier and travel time. It may change because of bakery workload, courier demand,
            traffic, weather or other circumstances outside Bulka’s control.</p>
          <p>After assignment, the courier’s name and phone number, estimated arrival time and a
            tracking link may be available if Yandex Delivery provides this information.</p>
          <p>The order is handed over at the stated address to the recipient or a person accepting
            it on the recipient’s behalf. If the recipient is absent or does not answer, the courier
            and Bulka will try to contact them. A repeat delivery, when required, is arranged
            separately.</p>
        </section>
        <section>
          <h2>6. Cancellation and delivery issues</h2>
          <p>Contact Bulka support as early as possible to cancel. Once Yandex Delivery confirms the
            request, a courier is assigned or the order is handed over, cancellation may be
            chargeable or unavailable. The decision and refund amount depend on the order status,
            incurred costs and the laws of the Republic of Kazakhstan.</p>
          <p>If the order is not delivered, is damaged, becomes cold because of a substantial delay,
            contains the wrong items or is incomplete, notify Bulka and provide the order number.
            Replacement, partial refund or full refund is reviewed under the
            <a href="/en/payment-and-refund">Payment and refund terms</a>.</p>
        </section>
        <section class="notice">
          <h2>7. Contacting us</h2>
          <p>Have the order number, delivery address and phone number used at checkout ready. A
            request may be sent through “Support” or by calling Bulka.</p>
          {{CONTACTS_EN}}
        </section>`,
    },
  },
  'company-details': {
    ru: {
      title: 'Реквизиты компании',
      description: 'Юридические, банковские и контактные реквизиты продавца Bulka.',
      updated: 'Актуально на 25 июля 2026 года',
      lead: ['ИП РУБЛЕВА', 'Юридические и банковские реквизиты Bulka'],
      details: [
        ['Компания', 'ИП РУБЛЕВА'],
        ['Юридический адрес', 'Казахстан, Актау, 32А, дом 6, кв./офис 24'],
        ['Город обслуживания интернет-заказов', 'Астана'],
        ['БИН (ИИН)', '680225402521'],
        ['Банк', 'АО «Kaspi Bank»'],
        ['КБе', '19'],
        ['БИК', 'CASPKZKA'],
        ['Номер счёта', 'KZ19722S000009046690'],
      ],
      body: `<section class="notice"><h2>Контакты</h2>{{CONTACTS_RU}}</section>`,
    },
    kk: {
      title: 'Компания деректемелері',
      description: 'Bulka сатушысының заңды, банктік және байланыс деректемелері.',
      updated: '2026 жылғы 25 шілдедегі жағдай бойынша',
      lead: ['ИП РУБЛЕВА', 'Bulka заңды және банктік деректемелері'],
      details: [
        ['Компания', 'ИП РУБЛЕВА'],
        ['Заңды мекенжай', 'Қазақстан, Ақтау, 32А, 6-үй, 24-пәтер/кеңсе'],
        ['Интернет-тапсырыстарға қызмет көрсету қаласы', 'Астана'],
        ['БСН (ЖСН)', '680225402521'],
        ['Банк', '«Kaspi Bank» АҚ'],
        ['БеК', '19'],
        ['БСК', 'CASPKZKA'],
        ['Шот нөмірі', 'KZ19722S000009046690'],
      ],
      body: `<section class="notice"><h2>Байланыс деректері</h2>{{CONTACTS_KK}}</section>`,
    },
    en: {
      title: 'Company details',
      description: 'Legal, banking and contact details of the Bulka seller.',
      updated: 'Current as of 25 July 2026',
      lead: ['SOLE PROPRIETOR RUBLEVA', 'Legal and banking details of Bulka'],
      details: [
        ['Registered entity', 'ИП РУБЛЕВА (Sole Proprietor Rubleva)'],
        ['Registered address', 'Kazakhstan, Aktau, 32A, building 6, apartment/office 24'],
        ['City served by online orders', 'Astana'],
        ['Business/individual identification number', '680225402521'],
        ['Bank', 'Kaspi Bank JSC'],
        ['Beneficiary code', '19'],
        ['Bank identification code', 'CASPKZKA'],
        ['Account number', 'KZ19722S000009046690'],
      ],
      body: `<section class="notice"><h2>Contacts</h2>{{CONTACTS_EN}}</section>`,
    },
  },
  privacy: {
    ru: {
      title: 'Политика конфиденциальности Bulka',
      description:
        'Как Bulka обрабатывает персональные данные, сведения о заказах, доставке и платежах.',
      updated: 'Дата обновления: 25 июля 2026 года',
      body: `
        <section>
          <h2>Какие данные мы используем</h2>
          <p>Для регистрации и обслуживания заказов Bulka обрабатывает имя, номер телефона,
            необязательные данные профиля и электронной почты, адреса доставки, геопозицию выбранной
            точки, историю заказов, состав и сумму платежей, возвраты, бонусные операции, выбранный
            язык и технические идентификаторы push-уведомлений.</p>
          <p>При карточной оплате Bulka может получить от банка только результат операции, платёжную
            систему, первые шесть и последние четыре цифры карты, код авторизации и идентификатор
            транзакции — в объёме, необходимом для торгового чека и разрешения споров. Полный номер
            карты, срок действия и CVC/CVV в Bulka не поступают и не хранятся.</p>
        </section>
        <section>
          <h2>Для чего нужны данные</h2>
          <p>Данные используются для авторизации, оформления и оплаты заказов, формирования и
            доставки торгового чека, возвратов, курьерской доставки, работы бонусной программы,
            уведомлений о статусе заказа, поддержки клиента, предотвращения злоупотреблений и
            улучшения сервиса. Мы не продаём персональные данные.</p>
        </section>
        <section>
          <h2>Получатели данных</h2>
          <p>Передача ограничивается необходимым объёмом и выполняется только для работы выбранной
            функции:</p>
          <ul>
            <li>Kaspi Pay — создание и проверка оплаты, а также возврат через исходный платёжный
              канал;</li>
            <li>АО «ForteBank» — проведение оплаты Visa и Mastercard, 3‑D Secure и возврат по
              карточной операции после активации интернет-эквайринга;</li>
            <li>Яндекс Доставка — имя, телефон, адрес, маршрут и сведения о заказе, необходимые
              курьеру;</li>
            <li>Firebase — доставка push-уведомлений;</li>
            <li>WhatsApp/Meta — доставка сообщений, одноразовых кодов и уведомлений, если клиент
              выбрал этот канал;</li>
            <li>картографический и геокодирующий сервисы — поиск выбранного пользователем адреса и
              проверка зоны доставки;</li>
            <li>iiko — состав заказа, филиал и операции программы лояльности;</li>
            <li>провайдеры ИИ Google Gemini, Alibaba Cloud/Qwen и DeepSeek — обработка текста,
              который пользователь или сотрудник явно отправил в функцию с ИИ. Перед отправкой
              Bulka ограничивает состав данных и по возможности удаляет прямые идентификаторы.</li>
          </ul>
          <p>Не отправляйте в функции с ИИ платёжные реквизиты, пароли, медицинские сведения или
            другие чувствительные данные. Обработка WhatsApp/Meta и провайдерами ИИ может включать
            трансграничную передачу в соответствии с их условиями и политиками
            конфиденциальности.</p>
        </section>
        <section>
          <h2>Сроки хранения и безопасность</h2>
          <p>Профиль и рабочие данные хранятся, пока действует аккаунт или это необходимо для
            обслуживания. Документы по заказам, оплатам, возвратам и торговые чеки могут храниться
            не менее пяти лет для бухгалтерского учёта, исполнения договора с банком, рассмотрения
            претензий и выполнения требований законодательства, даже после удаления аккаунта; при
            этом профиль обезличивается, когда это допустимо.</p>
          <p>Доступ администраторов журналируется, соединение использует HTTPS, а карточные реквизиты
            вводятся только на защищённой странице банка. Bulka не хранит данные, достаточные для
            повторного использования банковской карты.</p>
        </section>
        <section class="notice">
          <h2>Ваши права</h2>
          <p>В личном кабинете можно изменить профиль и адреса, отключить уведомления, выгрузить
            доступные данные и удалить аккаунт. Удаление также доступно на отдельной странице:
            <a href="/account-deletion">удалить аккаунт Bulka</a>. Вопросы можно направить по адресу
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a> или по телефону
            <a href="tel:+77012772233">+7 701 277 22 33</a>.</p>
        </section>`,
    },
    kk: {
      title: 'Bulka құпиялылық саясаты',
      description:
        'Bulka жеке деректерді, тапсырыс, жеткізу және төлем туралы мәліметтерді қалай өңдейді.',
      updated: 'Жаңартылған күні: 2026 жылғы 25 шілде',
      body: `
        <section>
          <h2>Қандай деректерді пайдаланамыз</h2>
          <p>Тіркеу және тапсырыстарға қызмет көрсету үшін Bulka аты-жөнді, телефон нөмірін,
            профиль мен электрондық поштаның міндетті емес деректерін, жеткізу мекенжайларын,
            таңдалған нүктенің геопозициясын, тапсырыстар тарихын, төлем құрамы мен сомасын,
            қайтаруларды, бонустық операцияларды, таңдалған тілді және push-хабарламалардың
            техникалық идентификаторларын өңдейді.</p>
          <p>Картамен төлеу кезінде Bulka банктен тек операция нәтижесін, төлем жүйесін, картаның
            алғашқы алты және соңғы төрт санын, авторизация кодын және транзакция идентификаторын —
            сауда чегін қалыптастыруға және дауларды шешуге қажетті көлемде ала алады. Картаның
            толық нөмірі, жарамдылық мерзімі және CVC/CVV Bulka-ға түспейді және сақталмайды.</p>
        </section>
        <section>
          <h2>Деректер не үшін қажет</h2>
          <p>Деректер авторизация, тапсырысты рәсімдеу және төлеу, сауда чегін қалыптастыру және
            жеткізу, ақшаны қайтару, курьерлік жеткізу, бонустық бағдарламаның жұмысы, тапсырыс
            мәртебесі туралы хабарлау, клиентке қолдау көрсету, теріс пайдаланудың алдын алу және
            сервисті жақсарту үшін қолданылады. Біз жеке деректерді сатпаймыз.</p>
        </section>
        <section>
          <h2>Деректерді алушылар</h2>
          <p>Деректер тек таңдалған функцияның жұмысына қажетті көлемде беріледі:</p>
          <ul>
            <li>Kaspi Pay — төлемді жасау және тексеру, сондай-ақ бастапқы төлем арнасы арқылы
              қайтару;</li>
            <li>«ForteBank» АҚ — интернет-эквайринг іске қосылғаннан кейін Visa және Mastercard
              төлемдерін, 3‑D Secure тексеруін және карта операциясы бойынша қайтаруды жүргізу;</li>
            <li>Яндекс Доставка — курьерге қажет аты-жөн, телефон, мекенжай, маршрут және тапсырыс
              мәліметтері;</li>
            <li>Firebase — push-хабарламаларды жеткізу;</li>
            <li>WhatsApp/Meta — клиент осы арнаны таңдаған жағдайда хабарламаларды, бір реттік
              кодтарды және ескертулерді жеткізу;</li>
            <li>картографиялық және геокодтау сервистері — пайдаланушы таңдаған мекенжайды іздеу
              және жеткізу аймағын тексеру;</li>
            <li>iiko — тапсырыс құрамы, филиал және адалдық бағдарламасының операциялары;</li>
            <li>Google Gemini, Alibaba Cloud/Qwen және DeepSeek ЖИ провайдерлері — пайдаланушы
              немесе қызметкер ЖИ функциясына әдейі жіберген мәтінді өңдеу. Bulka жіберілетін
              деректерді шектейді және мүмкіндігінше тікелей идентификаторларды жояды.</li>
          </ul>
          <p>ЖИ функцияларына төлем деректерін, құпиясөздерді, медициналық немесе басқа құпия
            ақпаратты жібермеңіз. WhatsApp/Meta және ЖИ провайдерлерінің өңдеуі олардың талаптары
            мен құпиялылық саясаттарына сәйкес трансшекаралық беруді қамтуы мүмкін.</p>
        </section>
        <section>
          <h2>Сақтау мерзімі және қауіпсіздік</h2>
          <p>Профиль мен жұмыс деректері аккаунт белсенді болғанша немесе қызмет көрсету үшін қажет
            болғанша сақталады. Тапсырыстар, төлемдер, қайтарулар және сауда чектері туралы құжаттар
            бухгалтерлік есеп, банкпен жасалған шартты орындау, шағымдарды қарау және заңнама
            талаптарын орындау үшін аккаунт жойылғаннан кейін де кемінде бес жыл сақталуы мүмкін;
            рұқсат етілген жағдайда профиль иесіздендіріледі.</p>
          <p>Әкімшілердің қолжетімділігі журналға жазылады, байланыс HTTPS қолданады, ал карта
            деректері тек банктің қорғалған бетінде енгізіледі. Bulka банк картасын қайта
            пайдалануға жеткілікті деректерді сақтамайды.</p>
        </section>
        <section class="notice">
          <h2>Сіздің құқықтарыңыз</h2>
          <p>Жеке кабинетте профиль мен мекенжайларды өзгертуге, хабарламаларды өшіруге, қолжетімді
            деректерді жүктеуге және аккаунтты жоюға болады. Жою жеке бетте де қолжетімді:
            <a href="/kk/account-deletion">Bulka аккаунтын жою</a>. Сұрақтарды
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a> мекенжайына
            немесе <a href="tel:+77012772233">+7 701 277 22 33</a> телефонына жіберуге болады.</p>
        </section>`,
    },
    en: {
      title: 'Bulka privacy policy',
      description:
        'How Bulka processes personal data and information about orders, delivery and payments.',
      updated: 'Updated on 25 July 2026',
      body: `
        <section>
          <h2>Data we use</h2>
          <p>To register customers and service orders, Bulka processes the customer’s name, phone
            number, optional profile and email information, delivery addresses, the geolocation of
            a selected point, order history, payment contents and amounts, refunds, bonus
            transactions, selected language and technical push-notification identifiers.</p>
          <p>For card payments, Bulka may receive from the bank only the operation result, payment
            system, first six and last four card digits, authorisation code and transaction
            identifier, to the extent required for the merchant receipt and dispute resolution.
            The full card number, expiry date and CVC/CVV are not received or stored by Bulka.</p>
        </section>
        <section>
          <h2>Why the data is needed</h2>
          <p>Data is used for authorisation, placing and paying for orders, issuing and delivering
            merchant receipts, refunds, courier delivery, the bonus programme, order-status
            notifications, customer support, fraud prevention and service improvement. We do not
            sell personal data.</p>
        </section>
        <section>
          <h2>Recipients of data</h2>
          <p>Disclosure is limited to what is required for the selected function:</p>
          <ul>
            <li>Kaspi Pay — creating and verifying payments and issuing refunds through the original
              payment channel;</li>
            <li>ForteBank JSC — processing Visa and Mastercard payments, 3‑D Secure and card refunds
              after internet acquiring is activated;</li>
            <li>Yandex Delivery — the name, phone number, address, route and order information
              required by the courier;</li>
            <li>Firebase — delivery of push notifications;</li>
            <li>WhatsApp/Meta — delivery of messages, one-time codes and notifications when the
              customer selects this channel;</li>
            <li>mapping and geocoding services — finding an address selected by the user and
              checking the delivery area;</li>
            <li>iiko — order contents, branch and loyalty-programme operations;</li>
            <li>AI providers Google Gemini, Alibaba Cloud/Qwen and DeepSeek — processing text that
              a user or employee deliberately submits to an AI feature. Bulka limits the data sent
              and removes direct identifiers where practicable.</li>
          </ul>
          <p>Do not submit payment credentials, passwords, medical information or other sensitive
            data to AI features. Processing by WhatsApp/Meta and AI providers may involve
            cross-border transfers under their terms and privacy policies.</p>
        </section>
        <section>
          <h2>Retention and security</h2>
          <p>The profile and operational data are retained while the account is active or as
            required to provide service. Documents concerning orders, payments, refunds and
            merchant receipts may be retained for at least five years for accounting, performance
            of the bank agreement, claims and legal requirements, including after account deletion;
            the profile is anonymised where permitted.</p>
          <p>Administrator access is logged, connections use HTTPS and card details are entered only
            on the bank’s protected page. Bulka does not store information sufficient to reuse a
            bank card.</p>
        </section>
        <section class="notice">
          <h2>Your rights</h2>
          <p>The account allows you to change your profile and addresses, disable notifications,
            export available data and delete the account. Deletion is also available on a separate
            page: <a href="/en/account-deletion">delete a Bulka account</a>. Questions may be sent to
            <a href="mailto:bulka.kazakhstan@mail.ru">bulka.kazakhstan@mail.ru</a> or asked by phone
            at <a href="tel:+77012772233">+7 701 277 22 33</a>.</p>
        </section>`,
    },
  },
  terms: {
    ru: {
      title: 'Условия использования Bulka',
      description: 'Правила использования сервиса Bulka, оформления заказов и бонусной программы.',
      updated: 'Дата обновления: 25 июля 2026 года',
      body: `
        <section>
          <h2>О сервисе</h2>
          <p>Приложение позволяет выбирать товары Bulka, оформлять самовывоз, предзаказ или доставку,
            оплачивать заказ через Kaspi Pay или банковской картой через ForteBank, когда этот
            способ доступен, и пользоваться бонусной программой. Доступность способов получения,
            товаров и времени зависит от выбранного филиала.</p>
        </section>
        <section>
          <h2>Заказ и оплата</h2>
          <p>Итоговая цена, состав, филиал, время и стоимость доставки показываются до оплаты.
            Заказ считается оплаченным после подтверждения платёжным сервисом. При отмене
            оплаченного заказа администратором возврат выполняется через исходный платёжный канал;
            срок зачисления зависит от банка. Подробный порядок опубликован на странице
            <a href="/payment-and-refund">«Условия оплаты и возврата»</a>. После подтверждённой
            оплаты формируется сохраняемый торговый чек, доступный в заказе и по ссылке,
            направленной на номер клиента.</p>
        </section>
        <section>
          <h2>Доставка и получение</h2>
          <p>Доставка доступна только в показанной на карте зоне. Пользователь отвечает за точность
            адреса, телефона и комментария курьеру. Время является плановым и может измениться
            из-за загрузки филиала, дорожной ситуации или обстоятельств вне контроля Bulka.</p>
        </section>
        <section>
          <h2>Аккаунт и бонусы</h2>
          <p>Пользователь обязан сохранять доступ к своему номеру телефона и не передавать коды
            входа. Правила начисления, использования и срока действия бонусов отображаются в
            приложении; бонусы не являются денежными средствами и не обмениваются на наличные.</p>
        </section>
        <section class="notice">
          <h2>Поддержка</h2>
          <p>Если возникла ошибка в заказе, оплате или возврате, обратитесь в Bulka через контакты,
            указанные в личном кабинете или на
            <a href="/company-details">официальной странице компании</a>, и сообщите номер
            заказа.</p>
        </section>`,
    },
    kk: {
      title: 'Bulka пайдалану шарттары',
      description: 'Bulka сервисін, тапсырыстарды және бонустық бағдарламаны пайдалану ережелері.',
      updated: 'Жаңартылған күні: 2026 жылғы 25 шілде',
      body: `
        <section>
          <h2>Сервис туралы</h2>
          <p>Қосымша Bulka тауарларын таңдауға, өздігінен алып кетуді, алдын ала тапсырысты немесе
            жеткізуді рәсімдеуге, қолжетімді болған кезде Kaspi Pay не ForteBank арқылы банк
            картасымен төлеуге және бонустық бағдарламаны пайдалануға мүмкіндік береді. Алу
            тәсілдерінің, тауарлар мен уақыттың қолжетімділігі таңдалған филиалға байланысты.</p>
        </section>
        <section>
          <h2>Тапсырыс және төлем</h2>
          <p>Қорытынды баға, құрам, филиал, уақыт және жеткізу құны төлемге дейін көрсетіледі.
            Төлем сервисі растағаннан кейін тапсырыс төленді деп есептеледі. Әкімші төленген
            тапсырысты болдырмаса, ақша бастапқы төлем арнасы арқылы қайтарылады; түсу мерзімі
            банкке байланысты. Толық тәртіп <a href="/kk/payment-and-refund">«Төлем және қайтару
            шарттары»</a> бетінде жарияланған. Расталған төлемнен кейін тапсырыста және клиенттің
            нөміріне жіберілген сілтеме бойынша сақтауға болатын сауда чегі қалыптастырылады.</p>
        </section>
        <section>
          <h2>Жеткізу және алу</h2>
          <p>Жеткізу картада көрсетілген аймақта ғана қолжетімді. Пайдаланушы мекенжайдың,
            телефонның және курьерге арналған түсініктеменің дұрыстығына жауап береді. Көрсетілген
            уақыт жоспарлы және филиалдың жүктемесіне, жол жағдайына немесе Bulka бақылауынан тыс
            мән-жайларға байланысты өзгеруі мүмкін.</p>
        </section>
        <section>
          <h2>Аккаунт және бонустар</h2>
          <p>Пайдаланушы телефон нөміріне қолжетімділігін сақтауға және кіру кодтарын басқаға
            бермеуге міндетті. Бонустарды есептеу, пайдалану және олардың жарамдылық мерзімі
            қосымшада көрсетіледі; бонустар ақша болып табылмайды және қолма-қол ақшаға
            айырбасталмайды.</p>
        </section>
        <section class="notice">
          <h2>Қолдау</h2>
          <p>Тапсырыста, төлемде немесе қайтаруда қате туындаса, жеке кабинетте не
            <a href="/kk/company-details">компанияның ресми бетінде</a> көрсетілген байланыстар
            арқылы Bulka-ға хабарласып, тапсырыс нөмірін айтыңыз.</p>
        </section>`,
    },
    en: {
      title: 'Bulka terms of use',
      description: 'Rules for using the Bulka service, placing orders and the bonus programme.',
      updated: 'Updated on 25 July 2026',
      body: `
        <section>
          <h2>About the service</h2>
          <p>The application allows customers to select Bulka products, arrange pickup, preorder or
            delivery, pay through Kaspi Pay or by bank card through ForteBank when that method is
            available, and use the bonus programme. The availability of fulfilment methods,
            products and times depends on the selected branch.</p>
        </section>
        <section>
          <h2>Orders and payment</h2>
          <p>The final price, contents, branch, time and delivery fee are shown before payment. An
            order is considered paid after confirmation by the payment service. When an
            administrator cancels a paid order, the refund is made through the original payment
            channel; the crediting time depends on the bank. The full procedure is published in the
            <a href="/en/payment-and-refund">Payment and refund terms</a>. After confirmed payment,
            a saveable merchant receipt is issued and is available in the order and through a link
            sent to the customer’s number.</p>
        </section>
        <section>
          <h2>Delivery and collection</h2>
          <p>Delivery is available only within the area shown on the map. The user is responsible
            for the accuracy of the address, phone number and courier comment. The stated time is
            planned and may change because of branch workload, road conditions or circumstances
            outside Bulka’s control.</p>
        </section>
        <section>
          <h2>Account and bonuses</h2>
          <p>The user must retain access to their phone number and must not share login codes. Rules
            on earning, using and expiry of bonuses are displayed in the application; bonuses are
            not money and cannot be exchanged for cash.</p>
        </section>
        <section class="notice">
          <h2>Support</h2>
          <p>If an error occurs with an order, payment or refund, contact Bulka using the details in
            the account or on the <a href="/en/company-details">official company page</a> and
            provide the order number.</p>
        </section>`,
    },
  },
};

const contactCards = {
  ru: `<div class="contacts">
    <a class="contact" href="tel:+77012772233"><span>Телефон Bulka</span><strong>+7 701 277 22 33</strong></a>
    <a class="contact" href="${BASE_URL}/"><span>Интернет-магазин</span><strong>${BASE_URL}/</strong></a>
    <a class="contact" href="mailto:bulka.kazakhstan@mail.ru"><span>Электронная почта</span><strong>bulka.kazakhstan@mail.ru</strong></a>
  </div>`,
  kk: `<div class="contacts">
    <a class="contact" href="tel:+77012772233"><span>Bulka телефоны</span><strong>+7 701 277 22 33</strong></a>
    <a class="contact" href="${BASE_URL}/"><span>Интернет-дүкен</span><strong>${BASE_URL}/</strong></a>
    <a class="contact" href="mailto:bulka.kazakhstan@mail.ru"><span>Электрондық пошта</span><strong>bulka.kazakhstan@mail.ru</strong></a>
  </div>`,
  en: `<div class="contacts">
    <a class="contact" href="tel:+77012772233"><span>Bulka phone</span><strong>+7 701 277 22 33</strong></a>
    <a class="contact" href="${BASE_URL}/"><span>Online shop</span><strong>${BASE_URL}/</strong></a>
    <a class="contact" href="mailto:bulka.kazakhstan@mail.ru"><span>Email</span><strong>bulka.kazakhstan@mail.ru</strong></a>
  </div>`,
};

const paymentLogos = `<div class="payment-logos" aria-label="ForteBank, Visa, Mastercard">
  <a class="payment-mark" href="https://forte.kz/" target="_blank" rel="noopener noreferrer"
    aria-label="ForteBank">
    <span class="forte-official-logo" aria-hidden="true"></span>
  </a>
  <div class="payment-mark" aria-label="Visa">
    <svg viewBox="0 0 150 48" role="img" aria-labelledby="visa-title">
      <title id="visa-title">Visa</title>
      <text x="18" y="35" fill="#1434cb" font-family="Arial,sans-serif" font-size="36"
        font-style="italic" font-weight="800">VISA</text>
    </svg>
  </div>
  <div class="payment-mark" aria-label="Mastercard">
    <svg viewBox="0 0 170 48" role="img" aria-labelledby="mastercard-title">
      <title id="mastercard-title">Mastercard</title>
      <circle cx="39" cy="24" r="19" fill="#eb001b"></circle>
      <circle cx="61" cy="24" r="19" fill="#f79e1b"></circle>
      <path d="M50 8.7a19 19 0 0 1 0 30.6 19 19 0 0 1 0-30.6Z" fill="#ff5f00"></path>
      <text x="88" y="29" fill="#111111" font-family="Arial,sans-serif" font-size="14"
        font-weight="700">mastercard</text>
    </svg>
  </div>
</div>`;

function normalizeLanguage(language) {
  return SUPPORTED_LEGAL_LANGUAGES.includes(language) ? language : 'ru';
}

function legalPagePath(language, slug) {
  const lang = normalizeLanguage(language);
  return lang === 'ru' ? `/${slug}` : `/${lang}/${slug}`;
}

function absoluteLegalPageUrl(language, slug) {
  return `${BASE_URL}${legalPagePath(language, slug)}`;
}

function languageLinks(language, slug) {
  const labels = common[language].languages;
  return SUPPORTED_LEGAL_LANGUAGES.map(
    (code) =>
      `<a href="${legalPagePath(code, slug)}" lang="${code}" hreflang="${code}"${
        code === language ? ' aria-current="page"' : ''
      }>${labels[code]}</a>`,
  ).join('');
}

function alternateLinks(slug) {
  return `${SUPPORTED_LEGAL_LANGUAGES.map(
    (code) =>
      `<link rel="alternate" hreflang="${code}" href="${absoluteLegalPageUrl(code, slug)}" />`,
  ).join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${absoluteLegalPageUrl('ru', slug)}" />`;
}

function renderSummary(items = []) {
  if (!items.length) return '';
  return `<div class="summary">${items
    .map(
      ([title, description]) =>
        `<article><strong>${title}</strong><span>${description}</span></article>`,
    )
    .join('')}</div>`;
}

function renderCompanyDetails(content) {
  if (!content.details) return '';
  return `<div class="company-lead"><strong>${content.lead[0]}</strong><span>${
    content.lead[1]
  }</span></div>
    <section><dl class="details-list">${content.details
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join('')}</dl></section>`;
}

function renderFooter(language, currentSlug) {
  const labels = common[language].footer;
  return `<footer>${LEGAL_PAGE_SLUGS.filter((slug) => slug !== currentSlug)
    .map((slug) => `<a href="${legalPagePath(language, slug)}">${labels[slug]}</a>`)
    .join('')}<span>© 2026 Bulka</span></footer>`;
}

function localizedBody(body) {
  return body
    .replaceAll('{{PAYMENT_LOGOS}}', paymentLogos)
    .replaceAll('{{CONTACTS_RU}}', contactCards.ru)
    .replaceAll('{{CONTACTS_KK}}', contactCards.kk)
    .replaceAll('{{CONTACTS_EN}}', contactCards.en);
}

function renderLegalPage(slug, language = 'ru') {
  const lang = normalizeLanguage(language);
  if (!LEGAL_PAGE_SLUGS.includes(slug)) return null;
  const content = pages[slug]?.[lang];
  if (!content) return null;
  const canonical = absoluteLegalPageUrl(lang, slug);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="description" content="${content.description}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${canonical}" />
    ${alternateLinks(slug)}
    <link rel="icon" type="image/png" sizes="660x660"
      href="/assets/wallet/bulka-wallet-logo.png?v=20260715" />
    <link rel="stylesheet" href="/assets/legal/legal.css?v=20260725" />
    <title>${content.title} — Bulka</title>
  </head>
  <body>
    <main>
      <header>
        <div class="topbar">
          <img class="brand" src="/assets/wallet/bulka-wallet-wide-logo.png?v=20260715"
            alt="Bulka" />
          <a class="back" href="/">${common[lang].back}</a>
        </div>
        <nav class="language-switcher" aria-label="${common[lang].language}">
          ${languageLinks(lang, slug)}
        </nav>
        <h1>${content.title}</h1>
        <p class="updated">${content.updated}</p>
      </header>
      ${renderSummary(content.summary)}
      ${renderCompanyDetails(content)}
      ${localizedBody(content.body)}
      ${renderFooter(lang, slug)}
    </main>
  </body>
</html>`;
}

function allLegalPagePaths() {
  return SUPPORTED_LEGAL_LANGUAGES.flatMap((language) =>
    LEGAL_PAGE_SLUGS.map((slug) => legalPagePath(language, slug)),
  );
}

module.exports = {
  LEGAL_PAGE_SLUGS,
  SUPPORTED_LEGAL_LANGUAGES,
  allLegalPagePaths,
  legalPagePath,
  renderLegalPage,
};
