import { Link } from 'react-router-dom'
import { useDB } from '../lib/data'

export function League() {
  const { db } = useDB()
  const telegram = db.settings?.telegramUrl
  const discord = db.settings?.discordUrl
  return (
    <div className="wrap page league-page">
      <p className="league-kicker">MSL / ОТКРЫТАЯ ЛИГА</p>
      <h1>Лиги и организаторы</h1>
      <p className="league-lead">Moscow Student's League — независимая площадка для студенческих команд и организаторов. Вуз, клуб или другая лига могут участвовать в турнирах и предлагать свои события. Принадлежность к конкретному вузу не требуется.</p>
      <div className="league-cards">
        <section>
          <span>01 / КОМАНДЕ</span>
          <h2>Играть в MSL</h2>
          <p>Создайте заявку команды, укажите состав и контакты. Организатор проверит её перед участием в турнире.</p>
          <Link to="/register?kind=team">Заявить команду</Link>
        </section>
        <section>
          <span>02 / ЛИГЕ И КЛУБУ</span>
          <h2>Подключить организацию</h2>
          <p>Расскажите, кого представляете и как с вами связаться. После проверки организация появится в каталоге; совместный турнир и роли согласуем отдельно.</p>
          <Link to="/register?kind=organization">Подать заявку организации</Link>
        </section>
        <section>
          <span>03 / ОРГАНИЗАТОРУ</span>
          <h2>Войти в команду</h2>
          <p>Нужны судьи, редакторы сетки, ведущие эфиров и люди для работы с командами. Напишите о своём опыте, доступном времени и желаемой роли. Доступ к панели выдаётся вручную после знакомства.</p>
          <div className="league-contact">
            {telegram && <a href={telegram} target="_blank" rel="noreferrer">Написать в Telegram</a>}
            {discord && <a href={discord} target="_blank" rel="noreferrer">Связаться в Discord</a>}
            {!telegram && !discord && <Link to="/register?kind=organization">Связаться через заявку</Link>}
          </div>
        </section>
      </div>
      <section className="league-process">
        <h2>Как проходит подключение</h2>
        <ol>
          <li>Отправляете заявку и указываете актуальный контакт.</li>
          <li>Команда MSL уточняет формат участия и проверяет данные.</li>
          <li>Согласуем турнир, ответственность и доступы. Публикация и права организатора не выдаются автоматически.</li>
        </ol>
        <Link to="/orgs">Смотреть организации</Link>
      </section>
    </div>
  )
}
