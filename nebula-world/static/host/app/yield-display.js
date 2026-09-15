/* Shared source display, deliberately independent of quantities and evaluator output. */
(function(g){'use strict';
function source(id){var r=g.SmileyYieldRecords&&g.SmileyYieldRecords[id];return r&&r.text?r.text:(r?'Yield wording unavailable in the prepared source record':'Source yield details not loaded');}
function line(id){return 'Source yield: '+source(id);}
function basis(n){return n?'Calculation basis: '+n+' servings':'Calculation basis: source batch; use Scale ×';}
g.SmileyYield={text:source,line:line,basis:basis};
})(window);
