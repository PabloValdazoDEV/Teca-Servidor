// Una cuenta está desactivada cuando la administración le ha quitado el acceso
// desde "Empleados". La agenda (profesional) se gestiona aparte: desactivar una
// agenda no bloquea el acceso, y una cuenta puede no tener agenda (recepción).
const accountStatusSelect = { disabledAt: true };

function isAccountDisabled(user) {
  return Boolean(user?.disabledAt);
}

const DISABLED_ACCOUNT_MESSAGE =
  "Tu cuenta está desactivada. Contacta con la administración de la clínica.";

module.exports = { DISABLED_ACCOUNT_MESSAGE, accountStatusSelect, isAccountDisabled };
