/* main.js - boot */
(function () {
  'use strict';
  function go() { Game.boot(document.getElementById('game')); Game.start(); document.getElementById('game').focus(); }
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
