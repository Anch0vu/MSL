import { groupStandings } from '../lib/bracket'
import { useDB } from '../lib/data'
import type { GroupStage } from '../lib/types'
import { TeamName } from './ui'

export function GroupTables({ stage, tid }: { stage: GroupStage; tid: string }) {
  const { records } = useDB()
  const recs = records(tid, stage.id)
  return (
    <div className="groups">
      {stage.groups.map((g) => {
        const rows = groupStandings(stage, g.name, recs)
        return (
          <div className="panel group" key={g.name}>
            <div className="panel-head">Группа {g.name}</div>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="left">Команда</th>
                  <th title="Сыграно">И</th>
                  <th title="Победы">В</th>
                  <th title="Ничьи">Н</th>
                  <th title="Поражения">П</th>
                  <th title="Разница карт">+/−</th>
                  <th title="Очки">О</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.team} className={i < stage.advance ? 'adv' : ''}>
                    <td className="pos">{i + 1}</td>
                    <td className="left">
                      <TeamName id={r.team} />
                    </td>
                    <td>{r.played}</td>
                    <td>{r.wins}</td>
                    <td>{r.draws}</td>
                    <td>{r.losses}</td>
                    <td>{r.mapsWon - r.mapsLost > 0 ? '+' : ''}{r.mapsWon - r.mapsLost}</td>
                    <td className="pts">{r.points}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      Команды ещё не распределены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
