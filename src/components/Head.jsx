import { useState } from 'react'
import { Hero, Tabs } from './ui.jsx'
import Semesters from './admin/Semesters.jsx'
import MyAudits from './MyAudits.jsx'

export default function Head({ profile, onOpen, startTab }) {
  const [tab, setTab] = useState(startTab ?? 'semesters')
  return (
    <>
      <Hero chip="Head of Faculty" title={<>Hello, <em>{profile.full_name || 'Head of Faculty'}</em></>}
        sub="Approve the audit list and the second auditors, and follow the results."
        nav={<Tabs value={tab} onChange={setTab} tabs={[['semesters', 'Semesters'], ['mine', 'My audits']]} />} />
      {tab === 'semesters' && <Semesters profile={profile} onOpen={onOpen} />}
      {tab === 'mine' && <MyAudits profile={profile} embedded />}
    </>
  )
}
