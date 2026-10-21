import { useState } from 'react'
import { Hero, Tabs } from './ui.jsx'
import Semesters from './admin/Semesters.jsx'
import Lecturers from './admin/Lecturers.jsx'
import Outbox from './admin/Outbox.jsx'
import MyAudits from './MyAudits.jsx'

// The admin is a lecturer too, so "My audits" is one of the tabs.
export default function Admin({ profile, onOpen, startTab }) {
  const [tab, setTab] = useState(startTab ?? 'semesters')
  return (
    <>
      <Hero chip="Admin" title={<>Hello, <em>{profile.full_name || 'admin'}</em></>}
        sub="Create a semester, load the lecturers, draw the audit list and send it to the Head of Faculty."
        nav={<Tabs value={tab} onChange={setTab} tabs={[['semesters', 'Semesters'], ['lecturers', 'Lecturers'], ['outbox', 'E-mail outbox'], ['mine', 'My audits']]} />} />
      {tab === 'semesters' && <Semesters profile={profile} onOpen={onOpen} />}
      {tab === 'lecturers' && <Lecturers />}
      {tab === 'outbox' && <Outbox />}
      {tab === 'mine' && <MyAudits profile={profile} embedded />}
    </>
  )
}
