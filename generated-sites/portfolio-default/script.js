// Navigation toggle for mobile
const navToggle = document.querySelector('.nav-toggle');
const navList = document.getElementById('nav-list');
navToggle.addEventListener('click', () => {
  const expanded = navToggle.getAttribute('aria-expanded') === 'true' || false;
  navToggle.setAttribute('aria-expanded', !expanded);
  navList.classList.toggle('show');
});
// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();
