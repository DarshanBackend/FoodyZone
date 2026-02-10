export const calculateDeliveryDate = (startDate, days) => {
  let currentDate = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < days) {
    currentDate.setDate(currentDate.getDate() + 1);
    if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
      daysAdded++;
    }
  }

  return currentDate;
};

export const getDeliveryInfo = (courierService) => {
  const today = new Date();
  let days = 4;

  if (courierService === "standard") {
    days = 2;
  }

  const estimatedDeliveryDate = calculateDeliveryDate(today, days);

  return {
    days,
    estimatedDeliveryDate
  };
};
