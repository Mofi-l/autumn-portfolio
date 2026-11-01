import { useEffect, useState } from 'react'
import { content, sections } from '../content'

/**
 * The scrollable HTML content layered over the fixed 3D canvas.
 * Each <section> is one full viewport tall so scroll progress maps
 * cleanly onto the 3D camera / model choreography.
 */
export default function Overlay({ active, onNavigate }) {
  const { name, title, intro, tagline, about, experience, skills, projects, contact } = content

  // Hero sub-line: show the "intro" ("Shadow Monk") first, then swap to the
  // real title after 5 seconds with a cross-fade.
  const [showTitle, setShowTitle] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShowTitle(true), 5000)
    return () => clearTimeout(t)
  }, [])


  return (
    <div className="overlay">
      {/* Fixed side navigation */}
      <nav className="side-nav" aria-label="Section navigation">
        {sections.map((s, i) => (
          <button
            key={s.id}
            className={`nav-dot ${active === i ? 'is-active' : ''}`}
            onClick={() => onNavigate(i)}
            aria-label={s.label}
          >
            <span className="nav-dot__mark" />
            <span className="nav-dot__label">{s.label}</span>
          </button>
        ))}
      </nav>

      {/* HERO */}
      <section className="section section--hero" id="hero">
        <div className="hero-inner">
          <p className="eyebrow">Portfolio of</p>
          <h1 className="hero-name">{name}</h1>
          <div className="hero-title-swap">
            <span className={`hero-title hero-title--intro ${showTitle ? 'is-hidden' : ''}`}>
              {intro}
            </span>
            <span className={`hero-title ${showTitle ? '' : 'is-hidden'}`}>
              {title}
            </span>
          </div>
          <p className="hero-tagline">{tagline}</p>
        </div>
        <div className="scroll-hint">
          <span>scroll into the dark</span>
          <span className="scroll-hint__arrow">↓</span>
        </div>
      </section>

      {/* ABOUT — character turns right & slides left, so content sits right */}
      <section className="section section--right" id="about">
        <div className="panel">
          <h2 className="section-heading">{about.heading}</h2>
          {about.body.map((p, i) => (
            <p className="section-body" key={i}>
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* EXPERIENCE — character slides right & faces left, so content sits left */}
      <section className="section section--left" id="experience">
        <div className="panel panel--tall">
          <h2 className="section-heading">{experience.heading}</h2>
          <ol className="timeline">
            {experience.items.map((e, i) => (
              <li className="timeline__item" key={i}>
                <div className="timeline__head">
                  <span className="timeline__role">{e.role}</span>
                  <span className="timeline__period">{e.period}</span>
                </div>
                <div className="timeline__org">
                  {e.org}
                  {e.current && <span className="timeline__current">Current Role</span>}
                </div>
                {e.achievements && (
                  <ul className="timeline__ach">
                    {e.achievements.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ul>
                )}
                {e.awards && (
                  <div className="timeline__awards">
                    {e.awards.map((a) => (
                      <span className="tag" key={a}>
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* SKILLS — character slides left & faces right, so content sits right */}
      <section className="section section--right" id="skills">
        <div className="panel panel--tall">
          <h2 className="section-heading">{skills.heading}</h2>

          <h3 className="skill-group__label">{skills.technical.label}</h3>
          <div className="skill-grid">
            {skills.technical.items.map((it) => (
              <div className="skill-card" key={it.name}>
                <span className="skill-card__icon">
                  {it.img ? (
                    <img
                      src={`${import.meta.env.BASE_URL}${it.img}`}
                      alt=""
                      aria-hidden="true"
                    />
                  ) : (
                    <i className={it.fa} aria-hidden="true" />
                  )}
                </span>
                <span className="skill-card__name">{it.name}</span>
              </div>
            ))}
          </div>

          <h3 className="skill-group__label skill-group__label--mt">
            {skills.core.label}
          </h3>
          <div className="skill-list skill-list--cloud">
            {skills.core.items.map((it) => (
              <span className="tag" key={it}>
                {it}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* PROJECTS — character faces back, centered; content centered */}
      <section className="section section--contracts" id="projects">
        <div className="contracts-wrap">
          <h2 className="section-heading section-heading--center">
            {projects.heading}
          </h2>
          <div className="contracts-grid">
            {projects.items.map((p) => (
              <a className="contract-card" href={p.link} key={p.name}>
                <h3 className="contract-card__name">{p.name}</h3>
                <p className="contract-card__desc">{p.desc}</p>
                <div className="contract-card__tags">
                  {p.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="section section--center" id="contact">
        <div className="panel panel--center">
          <h2 className="section-heading">{contact.heading}</h2>
          <p className="section-body">{contact.body}</p>
          <a className="contact-email" href={`mailto:${contact.email}`}>
            {contact.email}
          </a>
          <div className="socials">
            {contact.socials.map((s) => (
              <a key={s.label} href={s.url} target="_blank" rel="noreferrer">
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
