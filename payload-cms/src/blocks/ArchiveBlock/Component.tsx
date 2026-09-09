import React from 'react'

export const ArchiveBlock: React.FC<{ title?: string }> = ({ title }) => {
  return (
    <div className="container my-16">
      {title && <h2>{title}</h2>}
    </div>
  )
}
