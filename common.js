(function() {
  const navElem = document.getElementById('siteNav');
  if (navElem) {
    const toggle = navElem.querySelector('.nav__toggle');
    if (toggle) {
      toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        const isActive = navElem.classList.toggle('nav_active');
        toggle.setAttribute('aria-expanded', String(isActive));
      });
      document.addEventListener('click', function(e) {
        if (!navElem.contains(e.target)) {
          navElem.classList.remove('nav_active');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  const langElem = document.querySelector('.language');
  if (langElem) {
    const languagesData = langElem.dataset.languages;
    const currentLang = langElem.dataset.currentLang;
    const currentPath = langElem.dataset.currentPath;

    if (languagesData) {
      const languages = JSON.parse(decodeURIComponent(languagesData));
      const list = langElem.querySelector('.language__list');
      if (list && languages.length > 0) {
        languages.forEach(function(l) {
          const a = document.createElement('a');
          a.className = 'language__title' + (l.code === currentLang ? ' language__title_selected' : '');
          a.href = l.code === 'en' ? currentPath : '/' + l.code + currentPath;
          a.textContent = l.name;
          list.appendChild(a);
        });
      }
    }

    document.addEventListener('click', function(e) {
      if (!langElem.contains(e.target)) {
        langElem.classList.remove('language_active');
      } else {
        langElem.classList.toggle('language_active');
      }
    });
  }

  const popup = document.getElementById('termsPopup');
  const termsLink = document.getElementById('termsLink');
  const closeBtn = document.getElementById('termsClose');
  const termsContent = document.getElementById('termsContent');
  let termsLoaded = false;

  if (popup && termsLink && termsContent) {
    function openPopup(e) {
      e.preventDefault();
      popup.classList.add('popup_visible');
      document.body.style.overflow = 'hidden';

      if (!termsLoaded) {
        fetch('/terms')
          .then(r => r.text())
          .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const content = doc.body.innerHTML;
            termsContent.innerHTML = content;
            termsLoaded = true;
          });
      }
    }

    function closePopup() {
      popup.classList.remove('popup_visible');
      document.body.style.overflow = '';
    }

    termsLink.addEventListener('click', openPopup);
    if (closeBtn) closeBtn.addEventListener('click', closePopup);
    popup.addEventListener('click', function(e) {
      if (e.target === popup) closePopup();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && popup.classList.contains('popup_visible')) {
        closePopup();
      }
    });
  }
})();